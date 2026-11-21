import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  MatchResult,
  MatchReviewSchema,
  MatchRun,
} from '@trialmatch/shared';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import { InjectDb } from '../db/database';
import type { Db } from '../db/database';
import { matchResults, matchRuns, patients } from '../db/schema';
import { MatchEvents } from './events';
import { MatchQueue } from './queue';
import { toMatchResult, toMatchRun } from './runner';

type MatchReview = z.output<typeof MatchReviewSchema>;

export interface Referral {
  patient: typeof patients.$inferSelect;
  run: MatchRun;
  trials: MatchResult[];
}

/** Everything is scoped to the signed-in user, like patients themselves. */
@Injectable()
export class MatchingService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly queue: MatchQueue,
    private readonly events: MatchEvents,
  ) {}

  async start(ownerId: number, patientId: number): Promise<MatchRun> {
    const patient = await this.db.query.patients.findFirst({
      where: and(eq(patients.id, patientId), eq(patients.ownerId, ownerId)),
    });
    if (!patient) throw new NotFoundException('Patient not found.');

    const [row] = await this.db
      .insert(matchRuns)
      .values({ patientId, ownerId })
      .returning();
    try {
      await this.queue.enqueue(row.id);
    } catch {
      const [failed] = await this.db
        .update(matchRuns)
        .set({
          status: 'failed',
          stage: 'Failed',
          error: 'The job queue is unavailable. Try again shortly.',
          finishedAt: new Date(),
        })
        .where(eq(matchRuns.id, row.id))
        .returning();
      return toMatchRun(failed, []);
    }
    return toMatchRun(row, []);
  }

  async get(ownerId: number, runId: number): Promise<MatchRun> {
    const row = await this.db.query.matchRuns.findFirst({
      where: and(eq(matchRuns.id, runId), eq(matchRuns.ownerId, ownerId)),
    });
    if (!row) throw new NotFoundException('Match run not found.');
    const results = await this.db
      .select()
      .from(matchResults)
      .where(eq(matchResults.runId, runId))
      .orderBy(asc(matchResults.rank));
    return toMatchRun(row, results);
  }

  /** The patient's recent runs, newest first (results included for finished runs). */
  async listForPatient(
    ownerId: number,
    patientId: number,
    limit = 5,
  ): Promise<MatchRun[]> {
    const rows = await this.db
      .select()
      .from(matchRuns)
      .where(
        and(eq(matchRuns.patientId, patientId), eq(matchRuns.ownerId, ownerId)),
      )
      .orderBy(desc(matchRuns.createdAt), desc(matchRuns.id))
      .limit(limit);
    if (!rows.length) return [];
    const results = await this.db
      .select()
      .from(matchResults)
      .where(
        inArray(
          matchResults.runId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(matchResults.rank));
    return rows.map((r) =>
      toMatchRun(
        r,
        results.filter((x) => x.runId === r.id),
      ),
    );
  }

  /** Week 6: shortlist, dismiss or annotate one match. */
  async review(
    ownerId: number,
    resultId: number,
    input: MatchReview,
  ): Promise<MatchResult> {
    const [owned] = await this.db
      .select({ id: matchResults.id })
      .from(matchResults)
      .innerJoin(matchRuns, eq(matchRuns.id, matchResults.runId))
      .where(
        and(eq(matchResults.id, resultId), eq(matchRuns.ownerId, ownerId)),
      );
    if (!owned) throw new NotFoundException('Match not found.');
    const [row] = await this.db
      .update(matchResults)
      .set({
        decision: input.decision,
        note: input.note,
        decidedAt: input.decision === 'pending' ? null : new Date(),
      })
      .where(eq(matchResults.id, resultId))
      .returning();
    return toMatchResult(row);
  }

  /**
   * What the referral summary contains: the patient, and the shortlisted trials
   * of their latest finished run (in rank order).
   */
  async referral(ownerId: number, patientId: number): Promise<Referral> {
    const patient = await this.db.query.patients.findFirst({
      where: and(eq(patients.id, patientId), eq(patients.ownerId, ownerId)),
    });
    if (!patient) throw new NotFoundException('Patient not found.');
    const run = await this.db.query.matchRuns.findFirst({
      where: and(
        eq(matchRuns.patientId, patientId),
        eq(matchRuns.status, 'succeeded'),
      ),
      orderBy: [desc(matchRuns.createdAt), desc(matchRuns.id)],
    });
    const shortlisted = run
      ? await this.db
          .select()
          .from(matchResults)
          .where(
            and(
              eq(matchResults.runId, run.id),
              eq(matchResults.decision, 'shortlisted'),
            ),
          )
          .orderBy(asc(matchResults.rank))
      : [];
    if (!run || shortlisted.length === 0)
      throw new BadRequestException(
        'Shortlist at least one trial before downloading a referral summary.',
      );
    return {
      patient,
      run: toMatchRun(run, []),
      trials: shortlisted.map(toMatchResult),
    };
  }

  subscribe(runId: number, listener: (run: MatchRun) => void): () => void {
    return this.events.subscribe(runId, listener);
  }
}
