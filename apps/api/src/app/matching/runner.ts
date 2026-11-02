import { Logger } from '@nestjs/common';
import {
  decideEligibility,
  type CriterionAssessment,
  type Criterion,
  type MatchRun,
  type Patient,
  type TrialMatch,
} from '@trialmatch/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/database';
import {
  matchResults,
  matchRuns,
  patients,
  trialCriteria,
  trials,
} from '../db/schema';
import {
  PermanentMatchError,
  TransientMatchError,
  type MatchEngine,
  type TrialForMatching,
} from './engines';
import type { MatchEvents } from './events';
import { MAX_ATTEMPTS } from './queue';

type RunRow = typeof matchRuns.$inferSelect;
type ResultRow = typeof matchResults.$inferSelect;

const ELIGIBILITY_ORDER = {
  eligible: 0,
  possibly_eligible: 1,
  not_eligible: 2,
} as const;

/**
 * Processes one match run:
 *   5%   Finding candidate trials        (SQL: status, age, sex + full-text rank on conditions)
 *   10–90% Checking each trial's criteria (one engine call per trial)
 *   100% Done: "3 trials checked: 1 likely eligible, 1 needs review"
 *
 * Each status change is saved in its own short transaction (a slow AI call never
 * holds a database transaction open) and published for the live progress view.
 */
export class MatchRunner {
  private readonly log = new Logger(MatchRunner.name);

  constructor(
    private readonly db: Db,
    private readonly engine: MatchEngine,
    private readonly events: MatchEvents,
    private readonly options: { maxTrials: number; stepDelayMs: number },
  ) {}

  get engineName() {
    return this.engine.name;
  }

  /** 'retry' = a transient failure; the queue runs this attempt again later. */
  async run(runId: number, attempt: number): Promise<'done' | 'retry'> {
    const run = await this.db.query.matchRuns.findFirst({
      where: eq(matchRuns.id, runId),
    });
    if (!run || run.status === 'succeeded' || run.status === 'failed')
      return 'done'; // duplicate delivery
    const patientRow = await this.db.query.patients.findFirst({
      where: eq(patients.id, run.patientId),
    });
    if (!patientRow) return 'done'; // patient deleted meanwhile (the run is deleted with it)
    const patient = toPatient(patientRow);

    try {
      await this.update(runId, {
        status: 'running',
        attempts: attempt,
        error: null,
        engine: this.engine.name,
        progress: 5,
        stage: 'Finding candidate trials',
      });

      const candidates = await this.findCandidates(patient);
      if (candidates.length === 0) {
        await this.finish(
          runId,
          [],
          'No recruiting trials match this patient’s conditions, age and sex',
        );
        return 'done';
      }

      const results: Omit<TrialMatch, never>[] = [];
      for (const [i, trial] of candidates.entries()) {
        await this.update(runId, {
          progress: 10 + Math.round((80 * i) / candidates.length),
          stage: `Checking “${shorten(trial.title)}” (${i + 1} of ${candidates.length})`,
        });
        const raw = await this.engine.assess(patient, trial);
        const assessments: CriterionAssessment[] = raw.map((a) => {
          const c = trial.criteria.find(
            (x) => x.id === a.criterionId,
          ) as Criterion;
          return { ...a, code: c.code, type: c.type, text: c.text };
        });
        const { eligibility, score } = decideEligibility(assessments);
        results.push({
          trialId: trial.id,
          nctId: trial.nctId,
          title: trial.title,
          condition: trial.condition,
          eligibility,
          score,
          summary: summarize(assessments, eligibility),
          assessments,
        });
        if (this.options.stepDelayMs)
          await new Promise((r) => setTimeout(r, this.options.stepDelayMs));
      }

      results.sort(
        (a, b) =>
          ELIGIBILITY_ORDER[a.eligibility] - ELIGIBILITY_ORDER[b.eligibility] ||
          b.score - a.score,
      );
      const count = (e: TrialMatch['eligibility']) =>
        results.filter((r) => r.eligibility === e).length;
      await this.finish(
        runId,
        results,
        `${results.length} ${results.length === 1 ? 'trial' : 'trials'} checked: ` +
          `${count('eligible')} likely eligible, ${count('possibly_eligible')} need review`,
      );
      return 'done';
    } catch (err) {
      if (err instanceof TransientMatchError && attempt < MAX_ATTEMPTS) {
        await this.update(runId, {
          status: 'queued',
          progress: 0,
          stage: `${err.message}. Trying again shortly (attempt ${attempt + 1} of ${MAX_ATTEMPTS})`,
        });
        return 'retry';
      }
      const message =
        err instanceof PermanentMatchError || err instanceof TransientMatchError
          ? err.message
          : 'Unexpected error while matching. Please try again.';
      if (!(
        err instanceof PermanentMatchError || err instanceof TransientMatchError
      )) {
        this.log.error(err);
      }
      await this.update(runId, {
        status: 'failed',
        stage: 'Failed',
        error: message,
        finishedAt: new Date(),
      });
      return 'done';
    }
  }

  /**
   * Recruiting (or soon recruiting) trials the patient fits by age and sex,
   * ranked by how well the trial text matches the patient's conditions
   * (PostgreSQL full-text search, GIN-indexed).
   */
  async findCandidates(
    patient: Patient,
  ): Promise<(TrialForMatching & { nctId: string | null })[]> {
    if (patient.conditions.length === 0) return [];
    // websearch syntax: type 2 diabetes or obesity or … (words of one condition must all appear).
    // Punctuation is removed first: in websearch syntax a leading "-" means NOT.
    const terms = patient.conditions
      .map((c) =>
        c
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .trim(),
      )
      .filter(Boolean)
      .join(' or ');
    if (!terms) return [];
    const query = sql`websearch_to_tsquery('english', ${terms})`;
    const rank = sql<number>`ts_rank(${trials.searchVector}, ${query})`;
    const rows = await this.db
      .select({
        id: trials.id,
        nctId: trials.nctId,
        title: trials.title,
        condition: trials.condition,
        minAge: trials.minAge,
        maxAge: trials.maxAge,
        sex: trials.sex,
        rank,
      })
      .from(trials)
      .where(
        and(
          inArray(trials.status, ['recruiting', 'not_yet_recruiting']),
          sql`${trials.searchVector} @@ ${query}`,
          sql`(${trials.minAge} IS NULL OR ${trials.minAge} <= ${patient.age})`,
          sql`(${trials.maxAge} IS NULL OR ${trials.maxAge} >= ${patient.age})`,
          sql`${trials.sex} IN ('all', ${patient.sex})`,
        ),
      )
      .orderBy(desc(rank), desc(trials.id))
      .limit(this.options.maxTrials);

    if (rows.length === 0) return [];
    const criteria = await this.db
      .select()
      .from(trialCriteria)
      .where(
        inArray(
          trialCriteria.trialId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(trialCriteria.type), asc(trialCriteria.ordinal));
    return rows.map((t) => ({
      id: t.id,
      nctId: t.nctId,
      title: t.title,
      condition: t.condition,
      minAge: t.minAge,
      maxAge: t.maxAge,
      sex: t.sex,
      criteria: criteria
        .filter((c) => c.trialId === t.id)
        .map((c) => ({
          id: c.id,
          type: c.type,
          text: c.text,
          code: `${c.type === 'inclusion' ? 'I' : 'E'}${c.ordinal}`,
        })),
    }));
  }

  private async finish(runId: number, results: TrialMatch[], stage: string) {
    await this.db.transaction(async (tx) => {
      await tx.delete(matchResults).where(eq(matchResults.runId, runId)); // idempotent on retry
      if (results.length) {
        await tx.insert(matchResults).values(
          results.map((r, i) => ({
            runId,
            trialId: r.trialId,
            nctId: r.nctId,
            title: r.title,
            condition: r.condition,
            eligibility: r.eligibility,
            score: r.score,
            summary: r.summary,
            assessments: r.assessments,
            rank: i + 1,
          })),
        );
      }
    });
    await this.update(runId, {
      status: 'succeeded',
      progress: 100,
      stage,
      finishedAt: new Date(),
    });
  }

  private async update(runId: number, fields: Partial<RunRow>) {
    const [row] = await this.db
      .update(matchRuns)
      .set(fields)
      .where(eq(matchRuns.id, runId))
      .returning();
    if (!row) return;
    const results =
      row.status === 'succeeded'
        ? await this.db
            .select()
            .from(matchResults)
            .where(eq(matchResults.runId, runId))
            .orderBy(asc(matchResults.rank))
        : [];
    await this.events
      .publish(toMatchRun(row, results))
      .catch((err) => this.log.warn(`Event not published: ${err}`));
  }
}

export function toMatchRun(row: RunRow, results: ResultRow[]): MatchRun {
  return {
    id: row.id,
    patientId: row.patientId,
    status: row.status,
    progress: row.progress,
    stage: row.stage,
    engine: (row.engine as MatchRun['engine']) ?? null,
    error: row.error,
    results: results.map((r) => ({
      trialId: r.trialId ?? 0,
      nctId: r.nctId,
      title: r.title,
      condition: r.condition,
      eligibility: r.eligibility,
      score: r.score,
      summary: r.summary,
      assessments: r.assessments,
    })),
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

function toPatient(p: typeof patients.$inferSelect): Patient {
  return {
    id: p.id,
    pseudonym: p.pseudonym,
    age: p.age,
    sex: p.sex,
    conditions: p.conditions,
    medications: p.medications,
    notes: p.notes,
    version: p.version,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function summarize(
  assessments: CriterionAssessment[],
  eligibility: TrialMatch['eligibility'],
): string {
  const list = (items: CriterionAssessment[]) =>
    items.map((a) => a.code).join(', ');
  const blocking = assessments.filter(
    (a) =>
      (a.type === 'exclusion' && a.verdict === 'met') ||
      (a.type === 'inclusion' && a.verdict === 'not_met'),
  );
  const unknown = assessments.filter((a) => a.verdict === 'unknown');
  if (assessments.length === 0)
    return 'This trial lists no criteria yet. Review it by hand.';
  if (eligibility === 'not_eligible') return `Ruled out by ${list(blocking)}.`;
  if (eligibility === 'possibly_eligible')
    return `No criterion rules the patient out. Check ${list(unknown)} by hand.`;
  return 'Every criterion points towards eligibility. Confirm with the study team.';
}

const shorten = (s: string) => (s.length > 60 ? `${s.slice(0, 57)}…` : s);
