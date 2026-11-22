import {
  SYNCED_FIELDS,
  type CriteriaChange,
  type CriterionInput,
  type FieldChange,
  type RegistryTrialInput,
  type Trial,
} from '@trialmatch/shared';

/**
 * Week 8: what changed on ClinicalTrials.gov since TrialMatch last took the
 * record. `before` is that earlier registry version (the trial's snapshot), or
 * the trial itself for trials imported before snapshots existed. `current` is
 * the trial as it is now, shown next to the registry's value. A change the
 * trial already has (someone made the same edit here) is not listed.
 */
export function diffRegistry(
  before: RegistryTrialInput,
  after: RegistryTrialInput,
  current: Trial,
): { fields: FieldChange[]; criteria: CriteriaChange } {
  const fields = SYNCED_FIELDS.filter(
    (f) =>
      norm(before[f]) !== norm(after[f]) && norm(current[f]) !== norm(after[f]),
  ).map((field): FieldChange => ({
    field,
    current: current[field] ?? null,
    registry: after[field] ?? null,
  }));
  const key = (c: CriterionInput) => `${c.type}\u0000${norm(c.text)}`;
  const had = new Set(before.criteria.map(key));
  const has = new Set(after.criteria.map(key));
  const here = new Set(current.criteria.map(key));
  return {
    fields,
    criteria: {
      added: after.criteria.filter(
        (c) => !had.has(key(c)) && !here.has(key(c)),
      ),
      removed: before.criteria.filter(
        (c) => !has.has(key(c)) && here.has(key(c)),
      ),
    },
  };
}

export const hasChanges = (d: ReturnType<typeof diffRegistry>) =>
  d.fields.length > 0 ||
  d.criteria.added.length > 0 ||
  d.criteria.removed.length > 0;

/** The trial in the registry's shape: the baseline for trials without a snapshot. */
export function trialAsRegistryInput(t: Trial): RegistryTrialInput {
  return {
    nctId: t.nctId ?? '',
    title: t.title,
    condition: t.condition,
    phase: t.phase,
    status: t.status,
    sponsor: t.sponsor,
    summary: t.summary,
    minAge: t.minAge,
    maxAge: t.maxAge,
    sex: t.sex,
    criteria: t.criteria.map(({ type, text }) => ({ type, text })),
  };
}

/** Whitespace differences are not changes. */
const norm = (v: string | number | null | undefined) =>
  v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim();
