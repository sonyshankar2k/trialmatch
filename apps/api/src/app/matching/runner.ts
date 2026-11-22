import { Logger } from '@nestjs/common';
import {
  decideEligibility,
  type CriterionAssessment,
  type Criterion,
  type MatchResult,
  type MatchRun,
  type Patient,
  type TrialMatch,
} from '@trialmatch/shared';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
  ne,
  sql,
} from 'drizzle-orm';
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

export const ELIGIBILITY_ORDER = {
  eligible: 0,
  possibly_eligible: 1,
  not_eligible: 2,
} as const;

/** One patient–trial pair to assess. */
interface Pair {
  patient: Patient;
  trial: CandidateTrial;
}
type CandidateTrial = TrialForMatching & { nctId: string | null };
type Assessed = TrialMatch & { patientId: number; pseudonym: string };
type Review = Pick<ResultRow, 'decision' | 'note' | 'decidedAt' | 'reviewedAt'>;

/** What differs between a patient run and a trial run (Week 7). */
interface Job {
  ownerId: number;
  /** Trial runs: the version of the trial being screened. */
  trialVersion: number | null;
  finding: string;
  find: () => Promise<Pair[]>;
  /** What "Checking …" names for each pair. */
  label: (pair: Pair) => string;
  noun: [one: string, many: string];
  noneFound: string;
}

/**
 * Processes one match run. A patient run checks candidate trials for the patient;
 * a trial run (Week 7) checks the owner's candidate patients for the trial:
 *   5%   Finding candidates          (SQL: status, age, sex + full-text rank on conditions)
 *   10–90% Checking each pair        (one engine call per patient–trial pair)
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
    /** maxCandidates: how many trials (or patients) one run checks at most. */
    private readonly options: { maxCandidates: number; stepDelayMs: number },
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
    const job = await this.job(run);
    if (!job) return 'done'; // patient or trial deleted meanwhile (the run is deleted with it)

    try {
      await this.update(runId, {
        status: 'running',
        attempts: attempt,
        error: null,
        engine: this.engine.name,
        trialVersion: job.trialVersion,
        progress: 5,
        stage: job.finding,
      });

      const pairs = await job.find();
      if (pairs.length === 0) {
        await this.finish(run, [], job.noneFound);
        return 'done';
      }

      const results: Assessed[] = [];
      for (const [i, { patient, trial }] of pairs.entries()) {
        await this.update(runId, {
          progress: 10 + Math.round((80 * i) / pairs.length),
          stage: `Checking “${job.label({ patient, trial })}” (${i + 1} of ${pairs.length})`,
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
          patientId: patient.id,
          pseudonym: patient.pseudonym,
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
      const [one, many] = job.noun;
      await this.finish(
        run,
        results,
        `${results.length} ${results.length === 1 ? one : many} checked: ` +
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

  private async job(run: RunRow): Promise<Job | null> {
    if (run.trialId !== null) {
      const [row] = await this.db
        .select({ ...trialColumns, version: trials.version })
        .from(trials)
        .where(eq(trials.id, run.trialId));
      if (!row) return null;
      const { version, ...columns } = row;
      const [trial] = await this.withCriteria([columns]);
      return {
        ownerId: run.ownerId,
        trialVersion: version,
        finding: 'Finding candidate patients',
        find: async () =>
          (await this.findCandidatePatients(trial, run.ownerId)).map(
            (patient) => ({ patient, trial }),
          ),
        label: (p) => p.patient.pseudonym,
        noun: ['patient', 'patients'],
        noneFound:
          'None of your patients match this trial’s conditions, age and sex',
      };
    }
    const row = await this.db.query.patients.findFirst({
      where: eq(patients.id, run.patientId ?? 0),
    });
    if (!row) return null;
    const patient = toPatient(row);
    return {
      ownerId: run.ownerId,
      trialVersion: null,
      finding: 'Finding candidate trials',
      find: async () =>
        (await this.findCandidates(patient)).map((trial) => ({
          patient,
          trial,
        })),
      label: (p) => shorten(p.trial.title),
      noun: ['trial', 'trials'],
      noneFound:
        'No recruiting trials match this patient’s conditions, age and sex',
    };
  }

  /**
   * Recruiting (or soon recruiting) trials the patient fits by age and sex,
   * ranked by how well the trial text matches the patient's conditions
   * (PostgreSQL full-text search, GIN-indexed).
   */
  async findCandidates(patient: Patient): Promise<CandidateTrial[]> {
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
      .select(trialColumns)
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
      .limit(this.options.maxCandidates);
    return this.withCriteria(rows);
  }

  /**
   * Week 7: the owner's patients who fit the trial by age and sex and whose
   * conditions match the trial text, best match first. The same full-text rule
   * as findCandidates, run the other way: each patient's conditions become a
   * query against this trial's search vector (punctuation removed in SQL, as in
   * findCandidates, so a leading "-" can't mean NOT).
   */
  async findCandidatePatients(
    trial: CandidateTrial,
    ownerId: number,
  ): Promise<Patient[]> {
    const terms = sql`(
      select string_agg(term, ' or ')
      from (
        select nullif(trim(regexp_replace(lower(c), ${'[^a-z0-9[:space:]]'}, ' ', 'g')), '') as term
        from unnest(${patients.conditions}) as c
      ) as t
    )`;
    const query = sql`websearch_to_tsquery('english', ${terms})`;
    const rank = sql<number>`ts_rank(${trials.searchVector}, ${query})`;
    const rows = await this.db
      .select({ patient: patients, rank })
      .from(patients)
      .innerJoin(trials, eq(trials.id, trial.id))
      .where(
        and(
          eq(patients.ownerId, ownerId),
          sql`${trials.searchVector} @@ ${query}`,
          trial.minAge === null ? undefined : gte(patients.age, trial.minAge),
          trial.maxAge === null ? undefined : lte(patients.age, trial.maxAge),
          trial.sex === 'all' ? undefined : eq(patients.sex, trial.sex),
        ),
      )
      .orderBy(desc(rank), asc(patients.id))
      .limit(this.options.maxCandidates);
    return rows.map((r) => toPatient(r.patient));
  }

  /** Adds each trial's criteria, numbered I1, I2… / E1, E2…. */
  private async withCriteria(
    rows: Omit<CandidateTrial, 'criteria'>[],
  ): Promise<CandidateTrial[]> {
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

  private async finish(run: RunRow, results: Assessed[], stage: string) {
    await this.db.transaction(async (tx) => {
      await tx.delete(matchResults).where(eq(matchResults.runId, run.id)); // idempotent on retry
      if (results.length) {
        const previous = await this.previousReviews(tx, run, results);
        await tx.insert(matchResults).values(
          results.map((r, i) => ({
            runId: run.id,
            patientId: r.patientId,
            pseudonym: r.pseudonym,
            trialId: r.trialId,
            nctId: r.nctId,
            title: r.title,
            condition: r.condition,
            eligibility: r.eligibility,
            score: r.score,
            summary: r.summary,
            assessments: r.assessments,
            rank: i + 1,
            ...previous.get(pairKey(r)),
          })),
        );
      }
    });
    await this.update(run.id, {
      status: 'succeeded',
      progress: 100,
      stage,
      finishedAt: new Date(),
    });
  }

  /**
   * The latest saved review of each patient–trial pair in the owner's earlier
   * runs, from either side, so "Match again" (or screening a trial) keeps the
   * coordinator's shortlist, dismissals and notes.
   */
  private async previousReviews(
    tx: Pick<Db, 'select'>,
    run: RunRow,
    results: Assessed[],
  ): Promise<Map<string, Review>> {
    const rows = await tx
      .select({
        patientId: matchResults.patientId,
        trialId: matchResults.trialId,
        decision: matchResults.decision,
        note: matchResults.note,
        decidedAt: matchResults.decidedAt,
        reviewedAt: matchResults.reviewedAt,
      })
      .from(matchResults)
      .innerJoin(matchRuns, eq(matchRuns.id, matchResults.runId))
      .where(
        and(
          eq(matchRuns.ownerId, run.ownerId),
          ne(matchResults.runId, run.id),
          isNotNull(matchResults.reviewedAt),
          inArray(matchResults.patientId, [
            ...new Set(results.map((r) => r.patientId)),
          ]),
          inArray(matchResults.trialId, [
            ...new Set(results.map((r) => r.trialId)),
          ]),
        ),
      )
      .orderBy(desc(matchResults.reviewedAt), desc(matchResults.id));
    const latest = new Map<string, Review>();
    for (const { patientId, trialId, ...review } of rows) {
      if (patientId === null || trialId === null) continue;
      const key = pairKey({ patientId, trialId });
      if (!latest.has(key)) latest.set(key, review);
    }
    return latest;
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
    kind: row.trialId !== null ? 'trial' : 'patient',
    patientId: row.patientId,
    trialId: row.trialId,
    trialVersion: row.trialVersion,
    status: row.status,
    progress: row.progress,
    stage: row.stage,
    engine: (row.engine as MatchRun['engine']) ?? null,
    error: row.error,
    results: results.map((r) => toMatchResult(r)),
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

export function toMatchResult(r: ResultRow): MatchResult {
  return {
    id: r.id,
    patientId: r.patientId,
    pseudonym: r.pseudonym,
    trialId: r.trialId ?? 0,
    nctId: r.nctId,
    title: r.title,
    condition: r.condition,
    eligibility: r.eligibility,
    score: r.score,
    summary: r.summary,
    assessments: r.assessments,
    decision: r.decision,
    note: r.note,
    decidedAt: r.decidedAt?.toISOString() ?? null,
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

const pairKey = (r: { patientId: number; trialId: number }) =>
  `${r.patientId}:${r.trialId}`;

/** What matching needs of a trial (its criteria are loaded separately). */
const trialColumns = {
  id: trials.id,
  nctId: trials.nctId,
  title: trials.title,
  condition: trials.condition,
  minAge: trials.minAge,
  maxAge: trials.maxAge,
  sex: trials.sex,
};

const shorten = (s: string) => (s.length > 60 ? `${s.slice(0, 57)}…` : s);
