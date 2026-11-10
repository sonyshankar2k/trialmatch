/**
 * Converts ClinicalTrials.gov (API v2) study records into TrialMatch trials.
 * Pure functions, no I/O: everything here is unit-tested against real record shapes.
 *
 * The registry's data doesn't fit a form one-to-one (ages in months, combined
 * phases, eligibility written as free text with cohorts and sub-bullets), so
 * every place the import interprets or shortens something adds a warning the
 * person sees before importing.
 */
import type {
  CriterionInput,
  RegistryHit,
  RegistryTrialInput,
  TrialPhase,
  TrialStatus,
} from '@trialmatch/shared';

/** The parts of a v2 study record TrialMatch reads. Every field may be missing. */
export interface CtgovStudy {
  protocolSection?: {
    identificationModule?: {
      nctId?: string;
      briefTitle?: string;
      officialTitle?: string;
    };
    statusModule?: {
      overallStatus?: string;
      lastUpdatePostDateStruct?: { date?: string };
    };
    sponsorCollaboratorsModule?: { leadSponsor?: { name?: string } };
    descriptionModule?: { briefSummary?: string };
    conditionsModule?: { conditions?: string[] };
    designModule?: { studyType?: string; phases?: string[] };
    eligibilityModule?: {
      eligibilityCriteria?: string;
      sex?: string;
      minimumAge?: string;
      maximumAge?: string;
    };
  };
}

export const LIMITS = {
  title: 300,
  condition: 200,
  sponsor: 200,
  summary: 5000,
  criterion: 1000,
  criteria: 100,
  age: 120,
};

const STATUS_MAP: Record<string, TrialStatus> = {
  NOT_YET_RECRUITING: 'not_yet_recruiting',
  RECRUITING: 'recruiting',
  ENROLLING_BY_INVITATION: 'enrolling_by_invitation',
  ACTIVE_NOT_RECRUITING: 'active_not_recruiting',
  SUSPENDED: 'suspended',
  TERMINATED: 'terminated',
  COMPLETED: 'completed',
  WITHDRAWN: 'withdrawn',
  UNKNOWN: 'unknown',
};

export function mapStatus(raw: string | undefined, warnings: string[]) {
  const status = raw ? STATUS_MAP[raw] : undefined;
  if (status) return status;
  warnings.push(
    `Recruitment status "${raw ?? 'missing'}" isn't one TrialMatch tracks; imported as "Unknown status".`,
  );
  return 'unknown' as const;
}

export function mapPhase(raw: string[] | undefined, warnings: string[]) {
  const phases = [...new Set(raw ?? [])].sort().join('+');
  const known: Record<string, TrialPhase> = {
    '': 'Not applicable',
    NA: 'Not applicable',
    EARLY_PHASE1: 'Early Phase 1',
    PHASE1: 'Phase 1',
    'PHASE1+PHASE2': 'Phase 1/2',
    PHASE2: 'Phase 2',
    'PHASE2+PHASE3': 'Phase 2/3',
    PHASE3: 'Phase 3',
    PHASE4: 'Phase 4',
  };
  if (phases in known) return known[phases];
  // Unusual combinations: keep the most advanced phase listed.
  const order: TrialPhase[] = [
    'Early Phase 1',
    'Phase 1',
    'Phase 2',
    'Phase 3',
    'Phase 4',
  ];
  const listed = (raw ?? [])
    .map((p) => known[p])
    .filter((p): p is TrialPhase => order.includes(p));
  const phase = listed.sort((a, b) => order.indexOf(b) - order.indexOf(a))[0];
  warnings.push(
    `Phases ${(raw ?? []).join(', ')} were imported as "${phase ?? 'Not applicable'}".`,
  );
  return phase ?? 'Not applicable';
}

const UNIT_DAYS: Record<string, number> = {
  year: 365.25,
  month: 365.25 / 12,
  week: 7,
  day: 1,
  hour: 1 / 24,
  minute: 1 / 1440,
};

/** "18 Years" → 18, "6 Months" → 0 (with a warning), missing or "N/A" → null. */
export function parseAge(
  raw: string | undefined,
  label: 'Minimum' | 'Maximum',
  warnings: string[],
): number | null {
  if (!raw || /^n\/?a$/i.test(raw.trim())) return null;
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)\s*([a-z]+?)s?$/i);
  const unit = m?.[2].toLowerCase();
  if (!m || !unit || !(unit in UNIT_DAYS)) {
    warnings.push(`${label} age "${raw}" couldn't be read; left empty.`);
    return null;
  }
  const exact = (Number(m[1]) * UNIT_DAYS[unit]) / UNIT_DAYS['year'];
  // The minimum rounds down and the maximum up, so no patient the trial accepts is filtered out.
  let years = label === 'Minimum' ? Math.floor(exact) : Math.ceil(exact);
  if (unit !== 'year') {
    warnings.push(
      `${label} age is ${raw} on ClinicalTrials.gov; TrialMatch stores whole years, so it was imported as ${years}.`,
    );
  }
  if (years > LIMITS.age) {
    years = LIMITS.age;
    warnings.push(`${label} age ${raw} was capped at ${LIMITS.age} years.`);
  }
  return years;
}

function mapSex(raw: string | undefined): 'all' | 'female' | 'male' {
  if (raw === 'FEMALE') return 'female';
  if (raw === 'MALE') return 'male';
  return 'all';
}

function clip(
  text: string | undefined,
  max: number,
  label: string,
  warnings: string[],
): string | null {
  const t = text?.trim();
  if (!t) return null;
  if (t.length <= max) return t;
  warnings.push(`${label} was shortened to ${max} characters.`);
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

// ----------------------------------------------------------------- eligibility text

const HEADING =
  /^(?:key\s+|main\s+|major\s+)?(inclusion|exclusion)\s+criteria\b[^:]{0,80}:?\s*$/i;
/** "* ", "- ", "• ", "1. ", "1) ", "a. ", "(i) " */
const BULLET =
  /^(\s*)(?:[*\-•·▪◦]|\d{1,3}[.)]|[a-z][.)]|\([a-z0-9]{1,4}\))\s+(.*)$/i;

/** The registry stores markdown: "age \>= 18" means "age >= 18". */
export const unescapeMarkdown = (s: string) =>
  s.replace(/\\([\\`*_{}[\]()#+\-.!<>=~|^])/g, '$1');

/**
 * Splits the registry's free-text eligibility section into numbered inclusion
 * and exclusion criteria:
 * - "Inclusion Criteria:" / "Exclusion Criteria:" headings start a section (repeated
 *   headings, as in multi-cohort studies, keep adding to the same lists);
 * - a cohort line before a heading ("For healthy controls") prefixes the criteria under it;
 * - sub-bullets and wrapped lines join the criterion above them;
 * - intro lines ending in ":" ("Patients must meet all of the following:") are dropped.
 */
export function parseEligibility(raw: string | undefined, warnings: string[]) {
  const criteria: CriterionInput[] = [];
  if (!raw?.trim()) {
    warnings.push(
      'The study lists no eligibility criteria on ClinicalTrials.gov; matching will rely on age and sex only.',
    );
    return criteria;
  }

  const lines = unescapeMarkdown(raw.replace(/\r\n?/g, '\n')).split('\n');
  const hasHeadings = lines.some((l) => HEADING.test(l.trim()));
  let section: 'inclusion' | 'exclusion' | null = hasHeadings
    ? null
    : 'inclusion';
  let cohort: string | null = null;
  let current: CriterionInput | null = null;
  let topIndent = -1;
  let previousBlank = true;

  const nextNonBlank = (i: number) => {
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim()) return lines[j].trim();
    }
    return '';
  };
  const add = (text: string) => {
    if (!section) return;
    current = {
      type: section,
      text: cohort ? `${cohort}: ${text}` : text,
    };
    criteria.push(current);
  };

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) {
      previousBlank = true;
      return;
    }
    const wasBlank = previousBlank;
    previousBlank = false;

    const heading = trimmed.match(HEADING);
    if (heading) {
      section = heading[1].toLowerCase() as 'inclusion' | 'exclusion';
      current = null;
      topIndent = -1;
      return;
    }

    const bullet = line.match(BULLET);
    if (bullet) {
      const indent = bullet[1].replace(/\t/g, '    ').length;
      const text = bullet[2].trim();
      if (topIndent < 0) topIndent = indent;
      if (current && indent > topIndent) {
        // Sub-bullet ("any of the following: …"): part of the criterion above.
        const base = current.text.replace(/[;,]?\s*$/, '');
        current.text = base.endsWith(':')
          ? `${base} ${text}`
          : `${base}; ${text}`;
        return;
      }
      add(text);
      return;
    }

    if (current && !wasBlank) {
      current.text = `${current.text} ${trimmed}`; // wrapped line
      return;
    }
    // A short line right before a heading names a cohort ("For healthy controls").
    if (
      HEADING.test(nextNonBlank(i)) &&
      trimmed.length <= 80 &&
      !/[.]$|:./.test(trimmed)
    ) {
      cohort = trimmed.replace(/[:.]\s*$/, '');
      current = null;
      return;
    }
    if (!section) return; // text before the first heading
    if (trimmed.endsWith(':')) {
      current = null; // intro line for the list below it
      return;
    }
    add(trimmed); // a criterion written as a paragraph
  });

  if (!hasHeadings && criteria.length) {
    warnings.push(
      'The eligibility text has no "Inclusion/Exclusion Criteria" headings, so every item was imported as an inclusion criterion. Check for exclusions before matching.',
    );
  }
  if (hasHeadings && !criteria.length) {
    warnings.push(
      "The eligibility text couldn't be split into criteria; add them by hand after importing.",
    );
  }

  let shortened = 0;
  for (const c of criteria) {
    c.text = c.text.replace(/\s+/g, ' ').trim();
    if (c.text.length > LIMITS.criterion) {
      c.text = `${c.text.slice(0, LIMITS.criterion - 1).trimEnd()}…`;
      shortened++;
    }
  }
  if (shortened) {
    warnings.push(
      `${shortened} long criteri${shortened === 1 ? 'on was' : 'a were'} shortened to ${LIMITS.criterion} characters.`,
    );
  }
  if (criteria.length > LIMITS.criteria) {
    warnings.push(
      `The study has ${criteria.length} criteria; the first ${LIMITS.criteria} were imported.`,
    );
    criteria.length = LIMITS.criteria;
  }
  return criteria.filter((c) => c.text.length > 0);
}

// ----------------------------------------------------------------- whole records

export class NotATrialError extends Error {}

/** A full study record → trial input, plus warnings. */
export function studyToTrial(study: CtgovStudy): {
  trial: RegistryTrialInput;
  lastUpdated: string | null;
  sourceCriteriaText: string | null;
  warnings: string[];
} {
  const p = study.protocolSection ?? {};
  const nctId = p.identificationModule?.nctId;
  if (!nctId) throw new NotATrialError('The record has no NCT ID.');
  if (p.designModule?.studyType === 'EXPANDED_ACCESS') {
    throw new NotATrialError(
      `${nctId} is an expanded access program, not a clinical trial, so it has no eligibility criteria to match against.`,
    );
  }

  const warnings: string[] = [];
  const conditions = p.conditionsModule?.conditions ?? [];
  const title =
    p.identificationModule?.briefTitle ??
    p.identificationModule?.officialTitle ??
    nctId;
  const minAge = parseAge(p.eligibilityModule?.minimumAge, 'Minimum', warnings);
  let maxAge = parseAge(p.eligibilityModule?.maximumAge, 'Maximum', warnings);
  if (minAge != null && maxAge != null && maxAge < minAge) {
    warnings.push('The maximum age was below the minimum age; left empty.');
    maxAge = null;
  }

  const trial: RegistryTrialInput = {
    nctId,
    title: clip(title, LIMITS.title, 'The title', warnings) ?? nctId,
    condition:
      clip(
        conditions.join(', '),
        LIMITS.condition,
        'The list of conditions',
        warnings,
      ) ?? 'Not specified',
    phase: mapPhase(p.designModule?.phases, warnings),
    status: mapStatus(p.statusModule?.overallStatus, warnings),
    sponsor: clip(
      p.sponsorCollaboratorsModule?.leadSponsor?.name,
      LIMITS.sponsor,
      'The sponsor name',
      warnings,
    ),
    summary: clip(
      p.descriptionModule?.briefSummary
        ? unescapeMarkdown(p.descriptionModule.briefSummary)
        : undefined,
      LIMITS.summary,
      'The summary',
      warnings,
    ),
    minAge,
    maxAge,
    sex: mapSex(p.eligibilityModule?.sex),
    criteria: parseEligibility(
      p.eligibilityModule?.eligibilityCriteria,
      warnings,
    ),
  };
  if (!conditions.length) {
    warnings.push(
      'The study lists no conditions; matching finds trials by condition, so add one after importing.',
    );
  }
  return {
    trial,
    lastUpdated: p.statusModule?.lastUpdatePostDateStruct?.date ?? null,
    sourceCriteriaText: p.eligibilityModule?.eligibilityCriteria ?? null,
    warnings,
  };
}

/** A (possibly partial, `fields=`-filtered) search record → a result row. */
export function studyToHit(
  study: CtgovStudy,
): Omit<RegistryHit, 'importedTrialId'> | null {
  const p = study.protocolSection ?? {};
  const nctId = p.identificationModule?.nctId;
  if (!nctId) return null;
  const ignored: string[] = [];
  return {
    nctId,
    title:
      p.identificationModule?.briefTitle ??
      p.identificationModule?.officialTitle ??
      nctId,
    status: mapStatus(p.statusModule?.overallStatus, ignored),
    phase: mapPhase(p.designModule?.phases, ignored),
    conditions: p.conditionsModule?.conditions ?? [],
    sponsor: p.sponsorCollaboratorsModule?.leadSponsor?.name ?? null,
    minAge: parseAge(p.eligibilityModule?.minimumAge, 'Minimum', ignored),
    maxAge: parseAge(p.eligibilityModule?.maximumAge, 'Maximum', ignored),
    sex: mapSex(p.eligibilityModule?.sex),
    lastUpdated: p.statusModule?.lastUpdatePostDateStruct?.date ?? null,
  };
}
