/**
 * Database tables (Drizzle ORM). Migrations in apps/api/migrations are generated
 * from this file: `npx nx run api:db-generate` after a change.
 */
import { sql } from 'drizzle-orm';
import {
  check,
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
  SEXES,
  TRIAL_PHASES,
  TRIAL_STATUSES,
} from '@trialmatch/shared';

export const trialPhase = pgEnum('trial_phase', TRIAL_PHASES);
export const trialStatus = pgEnum('trial_status', TRIAL_STATUSES);
export const trialSex = pgEnum('trial_sex', SEXES);
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
    version: integer('version').notNull().default(1),
    createdById: integer('created_by_id')
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('trials_nct_id_key').on(t.nctId),
    index('trials_status_idx').on(t.status),
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
