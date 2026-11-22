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
import { and, asc, desc, eq, inArray, ne, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { InjectDb } from '../db/database';
import type { Db } from '../db/database';
import { matchResults, matchRuns, patients, trials } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { changesBetween } from '../audit/changes';
import { MatchEvents } from './events';
import { MatchQueue } from './queue';
import { ELIGIBILITY_ORDER, toMatchResult, toMatchRun } from './runner';

type MatchReview = z.output<typeof MatchReviewSchema>;

/** Trials worth screening patients for: the same statuses patient runs consider. */
const SCREENABLE_STATUSES = ['recruiting', 'not_yet_recruiting'] as const;

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
    private readonly audit: AuditService,
  ) {}

  async start(ownerId: number, patientId: number): Promise<MatchRun> {
    const patient = await this.db.query.patients.findFirst({
      where: and(eq(patients.id, patientId), eq(patients.ownerId, ownerId)),
    });
    if (!patient) throw new NotFoundException('Patient not found.');
    return this.enqueue({ patientId, ownerId }, patient.pseudonym);
  }

  /**
   * Week 7: "find patients for this trial". Trials are a shared catalog; the run
   * screens only the signed-in user's own patients.
   */
  async startForTrial(ownerId: number, trialId: number): Promise<MatchRun> {
    const trial = await this.db.query.trials.findFirst({
      where: eq(trials.id, trialId),
      columns: { status: true, title: true },
    });
    if (!trial) throw new NotFoundException('Trial not found.');
    if (!(SCREENABLE_STATUSES as readonly string[]).includes(trial.status))
      throw new BadRequestException(
        'Only recruiting or not yet recruiting trials can be screened.',
      );
    return this.enqueue({ trialId, ownerId }, trial.title);
  }

  private async enqueue(
    subject: { ownerId: number } & (
      { patientId: number } | { trialId: number }
    ),
    label: string,
  ): Promise<MatchRun> {
    const row = await this.db.transaction(async (tx) => {
      const [run] = await tx.insert(matchRuns).values(subject).returning();
      await this.audit.record(tx, {
        action: 'match.start',
        entityType: 'match_run',
        entityId: run.id,
        label,
        patientId: run.patientId,
        trialId: run.trialId,
        details: { kind: run.trialId !== null ? 'trial' : 'patient' },
      });
      return run;
    });
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
  listForPatient(ownerId: number, patientId: number): Promise<MatchRun[]> {
    return this.list(ownerId, eq(matchRuns.patientId, patientId));
  }

  /** Week 7: the user's recent screening runs for a trial, newest first. */
  async listForTrial(ownerId: number, trialId: number): Promise<MatchRun[]> {
    const trial = await this.db.query.trials.findFirst({
      where: eq(trials.id, trialId),
      columns: { id: true },
    });
    if (!trial) throw new NotFoundException('Trial not found.');
    return this.list(ownerId, eq(matchRuns.trialId, trialId));
  }

  private async list(
    ownerId: number,
    subject: SQL,
    limit = 5,
  ): Promise<MatchRun[]> {
    const rows = await this.db
      .select()
      .from(matchRuns)
      .where(and(subject, eq(matchRuns.ownerId, ownerId)))
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

  /**
   * Week 6: shortlist, dismiss or annotate one match. Since Week 7 a review
   * belongs to the patient–trial pair: it is saved on every result of the pair
   * in the owner's runs, so the patient's page and the trial's page agree.
   */
  async review(
    ownerId: number,
    resultId: number,
    input: MatchReview,
  ): Promise<MatchResult> {
    const [owned] = await this.db
      .select({
        patientId: matchResults.patientId,
        trialId: matchResults.trialId,
        title: matchResults.title,
        decision: matchResults.decision,
        note: matchResults.note,
      })
      .from(matchResults)
      .innerJoin(matchRuns, eq(matchRuns.id, matchResults.runId))
      .where(
        and(eq(matchResults.id, resultId), eq(matchRuns.ownerId, ownerId)),
      );
    if (!owned) throw new NotFoundException('Match not found.');
    const now = new Date();
    const review = {
      decision: input.decision,
      note: input.note,
      decidedAt: input.decision === 'pending' ? null : now,
      reviewedAt: now,
    };
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(matchResults)
        .set(review)
        .where(eq(matchResults.id, resultId))
        .returning();
      if (owned.patientId !== null && owned.trialId !== null) {
        await tx
          .update(matchResults)
          .set(review)
          .where(
            and(
              eq(matchResults.patientId, owned.patientId),
              eq(matchResults.trialId, owned.trialId),
              ne(matchResults.id, resultId),
              inArray(
                matchResults.runId,
                tx
                  .select({ id: matchRuns.id })
                  .from(matchRuns)
                  .where(eq(matchRuns.ownerId, ownerId)),
              ),
            ),
          );
      }
      // Review notes are free text about a patient: recorded as changed, not quoted.
      await this.audit.record(tx, {
        action: 'match.review',
        entityType: 'match_result',
        entityId: resultId,
        label: owned.title,
        patientId: owned.patientId,
        trialId: owned.trialId,
        changes: changesBetween(owned, row, ['decision', 'note'], ['note']),
      });
      return toMatchResult(row);
    });
  }

  /**
   * What the referral summary contains: the patient, and the trials shortlisted
   * for them. Each trial's newest assessment of this patient counts, whether it
   * came from the patient's own run or from screening the trial (Week 7).
   */
  async referral(ownerId: number, patientId: number): Promise<Referral> {
    const patient = await this.db.query.patients.findFirst({
      where: and(eq(patients.id, patientId), eq(patients.ownerId, ownerId)),
    });
    if (!patient) throw new NotFoundException('Patient not found.');
    const rows = await this.db
      .select({ result: matchResults, run: matchRuns })
      .from(matchResults)
      .innerJoin(matchRuns, eq(matchRuns.id, matchResults.runId))
      .where(
        and(
          eq(matchResults.patientId, patientId),
          eq(matchRuns.ownerId, ownerId),
          eq(matchRuns.status, 'succeeded'),
        ),
      )
      .orderBy(desc(matchRuns.createdAt), desc(matchRuns.id));
    const newest = new Map<number, (typeof rows)[number]>();
    for (const row of rows) {
      const trialId = row.result.trialId;
      if (trialId !== null && !newest.has(trialId)) newest.set(trialId, row);
    }
    const shortlisted = [...newest.values()]
      .filter((r) => r.result.decision === 'shortlisted')
      .sort(
        (a, b) =>
          ELIGIBILITY_ORDER[a.result.eligibility] -
            ELIGIBILITY_ORDER[b.result.eligibility] ||
          b.result.score - a.result.score,
      );
    if (shortlisted.length === 0)
      throw new BadRequestException(
        'Shortlist at least one trial before downloading a referral summary.',
      );
    // The PDF dates the assessment by the newest run it draws on.
    const run = shortlisted.reduce((a, b) =>
      b.run.createdAt > a.run.createdAt ? b : a,
    ).run;
    // Week 9: a referral leaves TrialMatch, so who downloaded which one is recorded.
    await this.audit.record(this.db, {
      action: 'referral.download',
      entityType: 'patient',
      entityId: patientId,
      label: patient.pseudonym,
      patientId,
      details: {
        trials: shortlisted.map((r) => r.result.nctId ?? r.result.title),
      },
    });
    return {
      patient,
      run: toMatchRun(run, []),
      trials: shortlisted.map((r) => toMatchResult(r.result)),
    };
  }

  subscribe(runId: number, listener: (run: MatchRun) => void): () => void {
    return this.events.subscribe(runId, listener);
  }
}
