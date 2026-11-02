import { z } from 'zod';
import { PageQuerySchema, VersionSchema, text } from './common.js';

export const TRIAL_PHASES = [
  'Phase 1',
  'Phase 2',
  'Phase 3',
  'Phase 4',
] as const;
export const TRIAL_STATUSES = [
  'not_yet_recruiting',
  'recruiting',
  'active_not_recruiting',
  'completed',
] as const;
export const SEXES = ['all', 'female', 'male'] as const;
export const CRITERION_TYPES = ['inclusion', 'exclusion'] as const;

export const TrialPhaseSchema = z.enum(TRIAL_PHASES);
export const TrialStatusSchema = z.enum(TRIAL_STATUSES);
export type TrialPhase = z.infer<typeof TrialPhaseSchema>;
export type TrialStatus = z.infer<typeof TrialStatusSchema>;

export const CriterionInputSchema = z.object({
  type: z.enum(CRITERION_TYPES),
  text: text(1000),
});
export type CriterionInput = z.infer<typeof CriterionInputSchema>;

const trialFields = {
  /** ClinicalTrials.gov style id, e.g. NCT01234567. Optional for draft trials. */
  nctId: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^NCT\d{8}$/, 'Format: NCT followed by 8 digits')
    .nullable()
    .optional(),
  title: text(300),
  condition: text(200),
  phase: TrialPhaseSchema,
  status: TrialStatusSchema,
  sponsor: z.string().trim().max(200).nullable().optional(),
  summary: z.string().trim().max(5000).nullable().optional(),
  minAge: z.number().int().min(0).max(120).nullable().optional(),
  maxAge: z.number().int().min(0).max(120).nullable().optional(),
  sex: z.enum(SEXES).default('all'),
  criteria: z.array(CriterionInputSchema).max(100).default([]),
};

const ageRangeIsValid = (t: {
  minAge?: number | null;
  maxAge?: number | null;
}) => t.minAge == null || t.maxAge == null || t.minAge <= t.maxAge;
const ageRangeError = {
  message: 'Must be at least the minimum age',
  path: ['maxAge'],
};

export const TrialCreateSchema = z
  .object(trialFields)
  .refine(ageRangeIsValid, ageRangeError);
export type TrialCreateInput = z.input<typeof TrialCreateSchema>;

/** Updates send only changed fields plus the version they read. Criteria, if sent, replace the list. */
export const TrialUpdateSchema = z
  .object({
    nctId: trialFields.nctId,
    title: trialFields.title.optional(),
    condition: trialFields.condition.optional(),
    phase: TrialPhaseSchema.optional(),
    status: TrialStatusSchema.optional(),
    sponsor: trialFields.sponsor,
    summary: trialFields.summary,
    minAge: trialFields.minAge,
    maxAge: trialFields.maxAge,
    sex: z.enum(SEXES).optional(),
    criteria: z.array(CriterionInputSchema).max(100).optional(),
    version: VersionSchema,
  })
  .refine(ageRangeIsValid, ageRangeError);
export type TrialUpdateInput = z.input<typeof TrialUpdateSchema>;

export const TrialListQuerySchema = PageQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  phase: TrialPhaseSchema.optional(),
  status: TrialStatusSchema.optional(),
});
export interface TrialListQuery {
  search?: string;
  phase?: TrialPhase;
  status?: TrialStatus;
  page?: number;
  pageSize?: number;
}

export interface Criterion extends CriterionInput {
  id: number;
  /** I1, I2… for inclusion, E1, E2… for exclusion. */
  code: string;
}

export interface Trial {
  id: number;
  nctId: string | null;
  title: string;
  condition: string;
  phase: TrialPhase;
  status: TrialStatus;
  sponsor: string | null;
  summary: string | null;
  minAge: number | null;
  maxAge: number | null;
  sex: (typeof SEXES)[number];
  criteria: Criterion[];
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Row in the trials list (no criteria, for a light response). */
export type TrialSummary = Omit<Trial, 'criteria' | 'summary'> & {
  criteriaCount: number;
};

export const STATUS_LABELS: Record<TrialStatus, string> = {
  not_yet_recruiting: 'Not yet recruiting',
  recruiting: 'Recruiting',
  active_not_recruiting: 'Active, not recruiting',
  completed: 'Completed',
};
