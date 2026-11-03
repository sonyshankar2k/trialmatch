import { Injectable, NotFoundException } from '@nestjs/common';
import type { MatchRun } from '@trialmatch/shared';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { InjectDb } from '../db/database';
import type { Db } from '../db/database';
import { matchResults, matchRuns, patients } from '../db/schema';
import { MatchEvents } from './events';
import { MatchQueue } from './queue';
import { toMatchRun } from './runner';

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

  subscribe(runId: number, listener: (run: MatchRun) => void): () => void {
    return this.events.subscribe(runId, listener);
  }
}
