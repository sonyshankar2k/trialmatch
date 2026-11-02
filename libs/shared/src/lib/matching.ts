import { z } from 'zod';

/**
 * AI eligibility matching. For one patient, candidate trials are found in the
 * database, then each criterion is assessed. The overall eligibility is computed
 * from the per-criterion verdicts by code (never taken from the model), so the
 * rule is the same for every engine and easy to audit.
 */
export const VERDICTS = ['met', 'not_met', 'unknown'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const ELIGIBILITY = [
  'eligible',
  'possibly_eligible',
  'not_eligible',
] as const;
export type Eligibility = (typeof ELIGIBILITY)[number];

export const MATCH_RUN_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
] as const;
export type MatchRunStatus = (typeof MATCH_RUN_STATUSES)[number];

export type MatchEngine = 'claude' | 'rules';

/** What an engine returns for one criterion (validated before it is stored). */
export const CriterionAssessmentSchema = z.object({
  criterionId: z.number().int(),
  verdict: z.enum(VERDICTS),
  /** One or two sentences a coordinator can check. */
  reason: z.string().trim().min(1).max(600),
  /** Words from the patient profile the verdict relies on, if any. */
  evidence: z.string().trim().max(300).nullable().optional(),
});
export type CriterionAssessmentInput = z.infer<
  typeof CriterionAssessmentSchema
>;

export interface CriterionAssessment extends CriterionAssessmentInput {
  code: string;
  type: 'inclusion' | 'exclusion';
  text: string;
}

export interface TrialMatch {
  trialId: number;
  nctId: string | null;
  title: string;
  condition: string;
  eligibility: Eligibility;
  /** 0–100: share of criteria that point towards eligibility. Ranking only. */
  score: number;
  /** Plain-language summary of the decision. */
  summary: string;
  assessments: CriterionAssessment[];
}

export interface MatchRun {
  id: number;
  patientId: number;
  status: MatchRunStatus;
  progress: number;
  stage: string;
  engine: MatchEngine | null;
  error: string | null;
  results: TrialMatch[];
  createdAt: string;
  finishedAt: string | null;
}

/** Server-sent event payload while a run is in progress. */
export type MatchRunEvent = { type: 'run'; run: MatchRun };

export const ELIGIBILITY_LABELS: Record<Eligibility, string> = {
  eligible: 'Likely eligible',
  possibly_eligible: 'Needs review',
  not_eligible: 'Not eligible',
};

/**
 * The decision rule:
 *  - an exclusion criterion that is met, or an inclusion criterion that is not met → not eligible
 *  - otherwise, anything unknown → needs review (a person must check)
 *  - otherwise → likely eligible
 */
export function decideEligibility(
  assessments: Pick<CriterionAssessment, 'type' | 'verdict'>[],
): { eligibility: Eligibility; score: number } {
  const blocking = assessments.some(
    (a) =>
      (a.type === 'exclusion' && a.verdict === 'met') ||
      (a.type === 'inclusion' && a.verdict === 'not_met'),
  );
  const favourable = assessments.filter(
    (a) =>
      (a.type === 'inclusion' && a.verdict === 'met') ||
      (a.type === 'exclusion' && a.verdict === 'not_met'),
  ).length;
  const score = assessments.length
    ? Math.round((favourable / assessments.length) * 100)
    : 0;
  if (blocking)
    return { eligibility: 'not_eligible', score: Math.min(score, 40) };
  if (assessments.some((a) => a.verdict === 'unknown'))
    return { eligibility: 'possibly_eligible', score };
  return { eligibility: 'eligible', score };
}
