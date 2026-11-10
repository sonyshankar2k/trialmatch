import type {
  Page,
  RegistryHit,
  RegistryPreview,
  Trial,
  TrialSummary,
} from '@trialmatch/shared';

export const aliceAuth = {
  accessToken: 'test-token',
  user: { id: 1, email: 'alice@trialmatch.dev', displayName: 'Alice Chen' },
};

export function makeTrial(overrides: Partial<Trial> = {}): Trial {
  return {
    id: 7,
    nctId: 'NCT99000001',
    title: 'GLP-1 agonist in type 2 diabetes',
    condition: 'Type 2 diabetes',
    phase: 'Phase 3',
    status: 'recruiting',
    sponsor: 'Northwind Therapeutics',
    summary: null,
    minAge: 18,
    maxAge: 75,
    sex: 'all',
    criteria: [
      { id: 1, type: 'inclusion', text: 'HbA1c 7–10.5%', code: 'I1' },
      { id: 2, type: 'exclusion', text: 'Type 1 diabetes', code: 'E1' },
    ],
    source: 'manual',
    sourceLastUpdated: null,
    version: 3,
    createdBy: 'Alice Chen',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
    ...overrides,
  };
}

export function pageOf(items: Trial[]): Page<TrialSummary> {
  return {
    items: items.map(({ criteria, summary: _summary, ...t }) => ({
      ...t,
      criteriaCount: criteria.length,
    })),
    total: items.length,
    page: 1,
    pageSize: 20,
  };
}

export function makeHit(overrides: Partial<RegistryHit> = {}): RegistryHit {
  return {
    nctId: 'NCT90000001',
    title: 'Exercise-induced asthma in adolescents',
    status: 'recruiting',
    phase: 'Not applicable',
    conditions: ['Exercise Induced Asthma'],
    sponsor: 'University Hospital Example',
    minAge: 12,
    maxAge: 24,
    sex: 'all',
    lastUpdated: '2026-10-14',
    importedTrialId: null,
    ...overrides,
  };
}

export function makePreview(
  overrides: Partial<RegistryPreview> = {},
): RegistryPreview {
  return {
    nctId: 'NCT90000001',
    trial: {
      nctId: 'NCT90000001',
      title: 'Exercise-induced asthma in adolescents',
      condition: 'Exercise Induced Asthma',
      phase: 'Not applicable',
      status: 'recruiting',
      sponsor: 'University Hospital Example',
      summary:
        'Adolescents with exercise-induced asthma perform an exercise challenge.',
      minAge: 12,
      maxAge: 24,
      sex: 'all',
      criteria: [
        { type: 'inclusion', text: 'Known exercise-induced asthma' },
        { type: 'inclusion', text: 'Age >=12 and <= 24' },
        {
          type: 'exclusion',
          text: 'Chronic asthma with systemic cortisone therapy',
        },
      ],
    },
    lastUpdated: '2026-10-14',
    sourceCriteriaText:
      'Inclusion Criteria:\n\n* known exercise induced asthma\n* age \\>=12 and \\<= 24\n\nExclusion Criteria:\n\n* chronic asthma with systemic cortisone therapy',
    warnings: [],
    importedTrialId: null,
    ...overrides,
  };
}
