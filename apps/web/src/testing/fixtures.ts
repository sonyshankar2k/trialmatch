import type { Page, Trial, TrialSummary } from '@trialmatch/shared';

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
