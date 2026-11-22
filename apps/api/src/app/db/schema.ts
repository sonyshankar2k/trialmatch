/**
 * Database tables (Drizzle ORM). SQL migrations in ./migrations are generated
 * from this file: `npm run db:generate` after a change.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  customType,
  jsonb,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  CRITERION_TYPES,
  ELIGIBILITY,
  MATCH_DECISIONS,
  MATCH_RUN_STATUSES,
  SEXES,
  TRIAL_PHASES,
  TRIAL_SOURCES,
  TRIAL_STATUSES,
  TRIAL_UPDATE_STATUSES,
  type CriteriaChange,
  type CriterionAssessment,
  type FieldChange,
  type RegistryTrialInput,
} from '@trialmatch/shared';

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

export const trialPhase = pgEnum('trial_phase', TRIAL_PHASES);
export const trialStatus = pgEnum('trial_status', TRIAL_STATUSES);
export const trialSex = pgEnum('trial_sex', SEXES);
export const trialSource = pgEnum('trial_source', TRIAL_SOURCES);
export const criterionType = pgEnum('criterion_type', CRITERION_TYPES);
export const patientSex = pgEnum('patient_sex', ['female', 'male']);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
};

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    email: varchar('email', { length: 254 }).notNull(),
    displayName: varchar('display_name', { length: 100 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [uniqueIndex('users_email_key').on(t.email)],
);

export const trials = pgTable(
  'trials',
  {
    id: serial('id').primaryKey(),
    nctId: varchar('nct_id', { length: 11 }),
    title: varchar('title', { length: 300 }).notNull(),
    condition: varchar('condition', { length: 200 }).notNull(),
    phase: trialPhase('phase').notNull(),
    status: trialStatus('status').notNull(),
    sponsor: varchar('sponsor', { length: 200 }),
    summary: text('summary'),
    minAge: integer('min_age'),
    maxAge: integer('max_age'),
    sex: trialSex('sex').notNull().default('all'),
    /** Week 5: typed in by hand, or imported from ClinicalTrials.gov. */
    source: trialSource('source').notNull().default('manual'),
    /** For imported trials: the registry record's last update date. */
    sourceLastUpdated: date('source_last_updated', { mode: 'string' }),
    /**
     * Week 8: the registry's version as TrialMatch last took it (on import, or
     * when an update was applied or kept). A sync compares the registry with
     * this, not with the trial, so local edits never look like registry changes.
     */
    sourceSnapshot: jsonb('source_snapshot').$type<RegistryTrialInput>(),
    sourceCheckedAt: timestamp('source_checked_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdById: integer('created_by_id')
      .notNull()
      .references(() => users.id),
    /** Full-text index over title, condition and summary: finds candidate trials for a patient. */
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`to_tsvector('english', title || ' ' || condition || ' ' || coalesce(summary, ''))`,
    ),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('trials_nct_id_key').on(t.nctId),
    index('trials_status_idx').on(t.status),
    index('trials_search_idx').using('gin', t.searchVector),
    check(
      'trials_age_range',
      sql`${t.minAge} IS NULL OR ${t.maxAge} IS NULL OR ${t.minAge} <= ${t.maxAge}`,
    ),
  ],
);

export const trialCriteria = pgTable(
  'trial_criteria',
  {
    id: serial('id').primaryKey(),
    trialId: integer('trial_id')
      .notNull()
      .references(() => trials.id, { onDelete: 'cascade' }),
    type: criterionType('type').notNull(),
    text: text('text').notNull(),
    /** Position within its type: 1, 2, 3… (shown as I1, I2… / E1, E2…). */
    ordinal: integer('ordinal').notNull(),
  },
  (t) => [index('trial_criteria_trial_idx').on(t.trialId, t.type, t.ordinal)],
);

export const patients = pgTable(
  'patients',
  {
    id: serial('id').primaryKey(),
    /** Patients are private to the user who created them. */
    ownerId: integer('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    pseudonym: varchar('pseudonym', { length: 30 }).notNull(),
    age: integer('age').notNull(),
    sex: patientSex('sex').notNull(),
    conditions: text('conditions')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    medications: text('medications')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    notes: text('notes'),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('patients_owner_pseudonym_key').on(t.ownerId, t.pseudonym),
  ],
);

// ----------------------------------------------------------------- Week 2: matching

export const matchRunStatus = pgEnum('match_run_status', MATCH_RUN_STATUSES);
export const eligibility = pgEnum('eligibility', ELIGIBILITY);
export const matchDecision = pgEnum('match_decision', MATCH_DECISIONS);

/**
 * One matching request, processed by the background worker: "find trials for
 * this patient" (patient_id set) or, since Week 7, "find patients for this
 * trial" (trial_id set; the owner's patients are screened). Exactly one is set.
 */
export const matchRuns = pgTable(
  'match_runs',
  {
    id: serial('id').primaryKey(),
    patientId: integer('patient_id').references(() => patients.id, {
      onDelete: 'cascade',
    }),
    trialId: integer('trial_id').references(() => trials.id, {
      onDelete: 'cascade',
    }),
    ownerId: integer('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: matchRunStatus('status').notNull().default('queued'),
    progress: integer('progress').notNull().default(0),
    stage: varchar('stage', { length: 200 })
      .notNull()
      .default('Waiting for a worker'),
    engine: varchar('engine', { length: 20 }),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    /**
     * Week 8, trial runs: the trial version the worker loaded and screened
     * (set when it starts, again on a retry). Null until then, and for runs
     * from before Week 8.
     */
    trialVersion: integer('trial_version'),
    createdAt: timestamps.createdAt,
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('match_runs_patient_idx').on(t.patientId, t.createdAt),
    index('match_runs_trial_idx').on(t.trialId, t.ownerId, t.createdAt),
    check(
      'match_runs_one_subject',
      sql`num_nonnulls(${t.patientId}, ${t.trialId}) = 1`,
    ),
  ],
);

/**
 * One assessed trial within a run. Title and NCT ID are copied, so a result
 * still reads correctly if the trial is edited or deleted later.
 */
export const matchResults = pgTable(
  'match_results',
  {
    id: serial('id').primaryKey(),
    runId: integer('run_id')
      .notNull()
      .references(() => matchRuns.id, { onDelete: 'cascade' }),
    trialId: integer('trial_id').references(() => trials.id, {
      onDelete: 'set null',
    }),
    /** Week 7: the patient of this pair (a trial run has one result per patient). */
    patientId: integer('patient_id').references(() => patients.id, {
      onDelete: 'cascade',
    }),
    pseudonym: varchar('pseudonym', { length: 30 }).notNull(),
    nctId: varchar('nct_id', { length: 11 }),
    title: varchar('title', { length: 300 }).notNull(),
    condition: varchar('condition', { length: 200 }).notNull(),
    eligibility: eligibility('eligibility').notNull(),
    score: integer('score').notNull(),
    summary: text('summary').notNull(),
    assessments: jsonb('assessments').$type<CriterionAssessment[]>().notNull(),
    /** Display order: best match first. */
    rank: integer('rank').notNull(),
    reviewed: boolean('reviewed').notNull().default(false),
    // Week 6: the coordinator's review (see MatchReviewSchema).
    decision: matchDecision('decision').notNull().default('pending'),
    note: text('note'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /**
     * Week 7: when the review was last saved (also when it was cleared). The
     * latest saved review of a patient–trial pair is carried into new runs from
     * either side.
     */
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (t) => [
    index('match_results_run_idx').on(t.runId, t.rank),
    index('match_results_pair_idx').on(t.patientId, t.trialId),
  ],
);

// ----------------------------------------------------------- Week 8: registry sync

export const trialUpdateStatus = pgEnum(
  'trial_update_status',
  TRIAL_UPDATE_STATUSES,
);

/**
 * A difference between an imported trial and ClinicalTrials.gov. At most one is
 * pending per trial (a newer registry change replaces it); applied and kept
 * ones stay as history.
 */
export const trialUpdates = pgTable(
  'trial_updates',
  {
    id: serial('id').primaryKey(),
    trialId: integer('trial_id')
      .notNull()
      .references(() => trials.id, { onDelete: 'cascade' }),
    /** Bumped when a newer registry change replaces the pending update. */
    revision: integer('revision').notNull().default(1),
    registryLastUpdated: date('registry_last_updated', { mode: 'string' }),
    fields: jsonb('fields').$type<FieldChange[]>().notNull(),
    criteria: jsonb('criteria').$type<CriteriaChange>().notNull(),
    /** The registry's version, which becomes the trial's snapshot once resolved. */
    snapshot: jsonb('snapshot').$type<RegistryTrialInput>().notNull(),
    warnings: jsonb('warnings').$type<string[]>().notNull(),
    status: trialUpdateStatus('status').notNull().default('pending'),
    detectedAt: timestamp('detected_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedById: integer('resolved_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    uniqueIndex('trial_updates_one_pending')
      .on(t.trialId)
      .where(sql`${t.status} = 'pending'`),
    index('trial_updates_trial_idx').on(t.trialId, t.detectedAt),
  ],
);
