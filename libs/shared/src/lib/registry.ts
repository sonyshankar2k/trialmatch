import { z } from 'zod';
import type { CriterionInput, TrialPhase, TrialStatus } from './trials.js';

/**
 * Importing real studies from ClinicalTrials.gov (the public US registry, API v2).
 * The API searches the registry and turns a study into a TrialMatch trial; the
 * person previews the result, with anything that needed judgement listed as a
 * warning, before importing it.
 */

export const NctIdSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^NCT\d{8}$/, 'Format: NCT followed by 8 digits');

/** Statuses a registry search can be narrowed to (the ones useful for finding trials to refer to). */
export const REGISTRY_SEARCH_STATUSES = [
  'recruiting',
  'not_yet_recruiting',
  'any',
] as const;

export const RegistrySearchQuerySchema = z
  .object({
    /** Disease or condition, e.g. "type 2 diabetes". */
    condition: z.string().trim().max(200).optional(),
    /** Any other words: drug, sponsor, NCT ID… */
    term: z.string().trim().max(200).optional(),
    status: z.enum(REGISTRY_SEARCH_STATUSES).default('recruiting'),
    /** Opaque token from the previous page's `nextPageToken`. */
    pageToken: z
      .string()
      .trim()
      .max(200)
      .regex(/^[\w-]+$/, 'Invalid page token')
      .optional(),
  })
  .refine((q) => q.condition || q.term, {
    message: 'Enter a condition or a search term',
    path: ['condition'],
  });
export type RegistrySearchQuery = z.input<typeof RegistrySearchQuerySchema>;

export const RegistryImportSchema = z.object({ nctId: NctIdSchema });
export type RegistryImportInput = z.input<typeof RegistryImportSchema>;

/** One study in a registry search result. */
export interface RegistryHit {
  nctId: string;
  title: string;
  status: TrialStatus;
  phase: TrialPhase;
  conditions: string[];
  sponsor: string | null;
  minAge: number | null;
  maxAge: number | null;
  sex: 'all' | 'female' | 'male';
  /** YYYY-MM-DD */
  lastUpdated: string | null;
  /** Set when this study is already in TrialMatch. */
  importedTrialId: number | null;
}

export interface RegistrySearchResult {
  items: RegistryHit[];
  /** Total matches on ClinicalTrials.gov (null if the registry did not say). */
  total: number | null;
  nextPageToken: string | null;
}

export interface RegistryTrialInput {
  nctId: string;
  title: string;
  condition: string;
  phase: TrialPhase;
  status: TrialStatus;
  sponsor: string | null;
  summary: string | null;
  minAge: number | null;
  maxAge: number | null;
  sex: 'all' | 'female' | 'male';
  criteria: CriterionInput[];
}

/** A study converted to a TrialMatch trial, before it is saved. */
export interface RegistryPreview {
  nctId: string;
  /** Valid input for creating a trial (TrialCreateSchema). */
  trial: RegistryTrialInput;
  /** YYYY-MM-DD */
  lastUpdated: string | null;
  /** The eligibility section as written on ClinicalTrials.gov, for comparison. */
  sourceCriteriaText: string | null;
  /** Things the import had to interpret or shorten; worth a look before matching. */
  warnings: string[];
  importedTrialId: number | null;
}

// ------------------------------------------------- Week 8: keeping imports in sync

/**
 * Imported trials are checked against ClinicalTrials.gov (daily, and on demand).
 * When the registry's version differs from what TrialMatch last took from it, a
 * pending update lists the differences; a person applies it or keeps the trial
 * as it is. Local edits are never overwritten without that choice.
 */
export const SYNCED_FIELDS = [
  'title',
  'condition',
  'phase',
  'status',
  'sponsor',
  'summary',
  'minAge',
  'maxAge',
  'sex',
] as const;
export type SyncedField = (typeof SYNCED_FIELDS)[number];

export const SYNCED_FIELD_LABELS: Record<SyncedField, string> = {
  title: 'Title',
  condition: 'Condition',
  phase: 'Phase',
  status: 'Status',
  sponsor: 'Sponsor',
  summary: 'Summary',
  minAge: 'Minimum age',
  maxAge: 'Maximum age',
  sex: 'Sex',
};

/** One field the registry changed: what TrialMatch has, and what the registry says now. */
export interface FieldChange {
  field: SyncedField;
  current: string | number | null;
  registry: string | number | null;
}

/** Criteria compared by type and wording: new on the registry, or no longer there. */
export interface CriteriaChange {
  added: CriterionInput[];
  removed: CriterionInput[];
}

export const TRIAL_UPDATE_STATUSES = [
  'pending',
  'applied',
  'dismissed',
] as const;
export type TrialUpdateStatus = (typeof TRIAL_UPDATE_STATUSES)[number];

export interface TrialUpdate {
  id: number;
  trialId: number;
  nctId: string;
  /** The registry record's last update date (YYYY-MM-DD). */
  registryLastUpdated: string | null;
  fields: FieldChange[];
  criteria: CriteriaChange;
  /** Things the conversion had to interpret, as on import. */
  warnings: string[];
  status: TrialUpdateStatus;
  detectedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

/** A trial's pending update (null when the trial is in step with the registry). */
export interface PendingTrialUpdate {
  update: TrialUpdate | null;
}

/** Applying an update edits the trial, so it carries the version the person read. */
export const TrialUpdateApplySchema = z.object({
  version: z.number().int().min(1),
});
export type TrialUpdateApplyInput = z.input<typeof TrialUpdateApplySchema>;

export interface RegistrySyncResult {
  /** Imported trials looked at. */
  checked: number;
  /** Trials with a pending update after this check. */
  updated: number;
  /** NCT IDs the registry could not be asked about (or no longer lists). */
  failed: string[];
  checkedAt: string;
}
