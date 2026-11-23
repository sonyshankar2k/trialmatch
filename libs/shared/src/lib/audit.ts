import { z } from 'zod';
import { PageQuerySchema } from './common.js';

/**
 * Week 9: the audit trail. Every sign-in, every change to a patient, trial or
 * review, every look at a patient record and every referral download is
 * recorded once, in the same transaction as the change, and never edited.
 */
export const AUDIT_ACTIONS = [
  'auth.register',
  'auth.login',
  'auth.login_failed',
  'patient.create',
  'patient.view',
  'patient.update',
  'patient.delete',
  'trial.create',
  'trial.import',
  'trial.update',
  'trial.delete',
  'registry.apply',
  'registry.dismiss',
  'match.start',
  'match.review',
  'referral.download',
  'audit.export',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  'auth.register': 'Created an account',
  'auth.login': 'Signed in',
  'auth.login_failed': 'Failed sign-in',
  'patient.create': 'Added patient',
  'patient.view': 'Opened patient record',
  'patient.update': 'Edited patient',
  'patient.delete': 'Deleted patient',
  'trial.create': 'Added trial',
  'trial.import': 'Imported trial from ClinicalTrials.gov',
  'trial.update': 'Edited trial',
  'trial.delete': 'Deleted trial',
  'registry.apply': 'Applied registry update',
  'registry.dismiss': 'Kept current version over registry update',
  'match.start': 'Started screening',
  'match.review': 'Reviewed match',
  'referral.download': 'Downloaded referral summary',
  'audit.export': 'Exported audit log',
};

export const AUDIT_ENTITY_TYPES = [
  'user',
  'patient',
  'trial',
  'trial_update',
  'match_run',
  'match_result',
  'audit',
] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

export const AUDIT_ENTITY_LABELS: Record<AuditEntityType, string> = {
  user: 'User',
  patient: 'Patient',
  trial: 'Trial',
  trial_update: 'Registry update',
  match_run: 'Screening run',
  match_result: 'Match',
  audit: 'Audit log',
};

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/**
 * One changed field. Free text that may describe a person (patient notes,
 * review notes) is `redacted`: the log says it changed, not what it says.
 */
export interface AuditChange {
  field: string;
  from?: Json;
  to?: Json;
  redacted?: boolean;
}

export interface AuditEvent {
  id: number;
  at: string;
  /** Null for events with no signed-in user (a failed sign-in, the daily registry check). */
  actor: { id: number; name: string } | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: number | null;
  /** What the record was called at the time (pseudonym, trial title), kept after deletion. */
  label: string | null;
  /** The patient and trial the event concerns, for each record's history. */
  patientId: number | null;
  trialId: number | null;
  changes: AuditChange[];
  details: Record<string, Json>;
  requestId: string | null;
  ip: string | null;
}

const optionalId = z.coerce.number().int().min(1).optional();
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .optional();

/** The admin audit log's filters (all optional); `to` includes that whole day. */
export const AuditQuerySchema = PageQuerySchema.extend({
  action: z.enum(AUDIT_ACTIONS).optional(),
  entityType: z.enum(AUDIT_ENTITY_TYPES).optional(),
  entityId: optionalId,
  patientId: optionalId,
  trialId: optionalId,
  /** Matches the actor's name or email. */
  actor: z.string().trim().max(100).optional(),
  from: day,
  to: day,
});
/** The filters as the web app sends them. */
export interface AuditQuery {
  page?: number;
  pageSize?: number;
  action?: AuditAction;
  entityType?: AuditEntityType;
  entityId?: number;
  patientId?: number;
  trialId?: number;
  actor?: string;
  from?: string;
  to?: string;
}
