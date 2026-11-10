/**
 * Mapper tests. The fixtures are shaped like ClinicalTrials.gov API v2 records;
 * their eligibility sections are copied from real registry records (with
 * placeholder NCT IDs), because the free text is where imports go wrong:
 * numbered lists, intro lines, escaped markdown and multi-cohort studies.
 */
import { TrialCreateSchema } from '@trialmatch/shared';
import {
  mapPhase,
  mapStatus,
  NotATrialError,
  parseAge,
  parseEligibility,
  studyToHit,
  studyToTrial,
  unescapeMarkdown,
} from './ctgov-mapper';
import { fixture } from './fixtures/load';

const cohorts = fixture('cohorts');
const numbered = fixture('numbered');
const bullets = fixture('bullets');

const texts = (c: { type: string; text: string }[], type: string) =>
  c.filter((x) => x.type === type).map((x) => x.text);

describe('studyToTrial', () => {
  it('maps a full record to valid trial input', () => {
    const { trial, lastUpdated, warnings } = studyToTrial(cohorts);
    expect(trial).toMatchObject({
      nctId: 'NCT90000001',
      title:
        'Exercise-induced asthma in adolescents: airway inflammation markers',
      condition: 'Exercise Induced Asthma, Asthma in Children',
      phase: 'Not applicable',
      status: 'recruiting',
      sponsor: 'University Hospital Example',
      minAge: 12,
      maxAge: 24,
      sex: 'all',
    });
    expect(lastUpdated).toBe('2026-10-14');
    expect(warnings).toEqual([]);
    // Whatever the registry sends, the result passes the same validation as the form.
    expect(TrialCreateSchema.safeParse(trial).success).toBe(true);
  });

  it('prefixes criteria with their cohort and unescapes markdown', () => {
    const { trial } = studyToTrial(cohorts);
    const inc = texts(trial.criteria, 'inclusion');
    const exc = texts(trial.criteria, 'exclusion');
    expect(inc[0]).toBe('For EIA patients: written agreement');
    expect(inc[1]).toBe('For EIA patients: age >=12 and <= 24');
    expect(inc).toContain('For healthy controls: age >=18 and <= 24');
    expect(exc[0]).toBe('For EIA patients: age < 12 und > 24 years');
    expect(exc).toContain('For healthy controls: eNO > 30 ppb');
    expect(inc).toHaveLength(8);
    expect(exc).toHaveLength(19);
    expect(trial.criteria.some((c) => c.text.includes('\\'))).toBe(false);
  });

  it('reads numbered lists and drops intro lines', () => {
    const { trial, warnings } = studyToTrial(numbered);
    const inc = texts(trial.criteria, 'inclusion');
    const exc = texts(trial.criteria, 'exclusion');
    expect(inc).toHaveLength(3);
    expect(inc[0]).toMatch(/^Healthy volunteers aged 18 years/);
    expect(exc).toHaveLength(15);
    expect(exc[0]).toBe(
      'Self-reported pregnant or nursing at the screening visit;',
    );
    expect(exc.some((t) => t.startsWith('Subjects must be excluded'))).toBe(
      false,
    );
    expect(trial.phase).toBe('Phase 1/2');
    expect(trial.status).toBe('completed');
    expect(trial.maxAge).toBeNull();
    expect(warnings).toEqual([]);
  });

  it('maps sex, bullets and newer statuses', () => {
    const { trial } = studyToTrial(bullets);
    expect(trial).toMatchObject({
      sex: 'female',
      minAge: 21,
      maxAge: 70,
      status: 'enrolling_by_invitation',
      phase: 'Phase 2',
    });
    expect(texts(trial.criteria, 'inclusion')).toHaveLength(2);
    expect(texts(trial.criteria, 'exclusion')).toEqual([
      expect.stringMatching(/^Under 21 years of age, Pregnant/),
    ]);
  });

  it('refuses records that are not trials', () => {
    expect(() => studyToTrial({})).toThrow(NotATrialError);
    expect(() =>
      studyToTrial({
        protocolSection: {
          identificationModule: { nctId: 'NCT90000009' },
          designModule: { studyType: 'EXPANDED_ACCESS' },
        },
      }),
    ).toThrow(/expanded access/);
  });

  it('fills gaps in sparse records and says so', () => {
    const { trial, warnings } = studyToTrial({
      protocolSection: { identificationModule: { nctId: 'NCT90000010' } },
    });
    expect(trial).toMatchObject({
      title: 'NCT90000010',
      condition: 'Not specified',
      phase: 'Not applicable',
      status: 'unknown',
      sponsor: null,
      summary: null,
      minAge: null,
      maxAge: null,
      criteria: [],
    });
    expect(warnings.join(' ')).toMatch(/no eligibility criteria/);
    expect(warnings.join(' ')).toMatch(/no conditions/);
    expect(TrialCreateSchema.safeParse(trial).success).toBe(true);
  });

  it('shortens fields that exceed TrialMatch limits', () => {
    const { trial, warnings } = studyToTrial({
      protocolSection: {
        identificationModule: {
          nctId: 'NCT90000011',
          briefTitle: 'T'.repeat(400),
        },
        conditionsModule: { conditions: ['C'.repeat(150), 'D'.repeat(150)] },
        eligibilityModule: {
          eligibilityCriteria: `Inclusion Criteria:\n\n* ${'x'.repeat(1500)}\n${Array.from(
            { length: 120 },
            (_, i) => `* item ${i}`,
          ).join('\n')}`,
        },
      },
    });
    expect(trial.title).toHaveLength(300);
    expect(trial.condition).toHaveLength(200);
    expect(trial.criteria).toHaveLength(100);
    expect(trial.criteria[0].text).toHaveLength(1000);
    expect(warnings).toHaveLength(5); // the four above, plus the missing status
    expect(TrialCreateSchema.safeParse(trial).success).toBe(true);
  });
});

describe('parseEligibility', () => {
  it('joins sub-bullets and wrapped lines to their criterion', () => {
    const w: string[] = [];
    const c = parseEligibility(
      [
        'Inclusion Criteria:',
        '',
        '* Adults with one of:',
        '  * type 2 diabetes',
        '  * prediabetes',
        '* BMI 27 or higher, measured',
        '  at screening',
        '',
        'Key Exclusion Criteria:',
        '',
        '- Pregnancy',
      ].join('\n'),
      w,
    );
    expect(c).toEqual([
      {
        type: 'inclusion',
        text: 'Adults with one of: type 2 diabetes; prediabetes',
      },
      { type: 'inclusion', text: 'BMI 27 or higher, measured at screening' },
      { type: 'exclusion', text: 'Pregnancy' },
    ]);
    expect(w).toEqual([]);
  });

  it('keeps paragraph-style criteria', () => {
    const c = parseEligibility(
      'Inclusion Criteria:\n\nAdults aged 18 or over with chronic migraine.\n\nExclusion Criteria:\n\nPrior botulinum toxin treatment.',
      [],
    );
    expect(c).toEqual([
      {
        type: 'inclusion',
        text: 'Adults aged 18 or over with chronic migraine.',
      },
      { type: 'exclusion', text: 'Prior botulinum toxin treatment.' },
    ]);
  });

  it('treats text without headings as inclusion criteria, with a warning', () => {
    const w: string[] = [];
    const c = parseEligibility('* Age 18 or older\n* Signed consent', w);
    expect(texts(c, 'inclusion')).toEqual([
      'Age 18 or older',
      'Signed consent',
    ]);
    expect(w[0]).toMatch(/no "Inclusion\/Exclusion Criteria" headings/);
  });

  it('warns when nothing could be split out', () => {
    const w: string[] = [];
    expect(
      parseEligibility('Inclusion Criteria:\n\nExclusion Criteria:', w),
    ).toEqual([]);
    expect(w[0]).toMatch(/couldn't be split/);
  });

  it('handles Windows line endings', () => {
    const c = parseEligibility('Inclusion Criteria:\r\n\r\n* A\r\n* B\r\n', []);
    expect(texts(c, 'inclusion')).toEqual(['A', 'B']);
  });
});

describe('field mapping', () => {
  it('parses ages in any unit, rounding so no eligible patient is filtered out', () => {
    const w: string[] = [];
    expect(parseAge('18 Years', 'Minimum', w)).toBe(18);
    expect(parseAge('1 Year', 'Minimum', w)).toBe(1);
    expect(parseAge(undefined, 'Minimum', w)).toBeNull();
    expect(parseAge('N/A', 'Maximum', w)).toBeNull();
    expect(w).toEqual([]);
    expect(parseAge('6 Months', 'Minimum', w)).toBe(0);
    expect(parseAge('18 Months', 'Maximum', w)).toBe(2);
    expect(parseAge('28 Days', 'Minimum', w)).toBe(0);
    expect(w).toHaveLength(3);
    expect(parseAge('150 Years', 'Maximum', w)).toBe(120);
    expect(parseAge('soon', 'Maximum', w)).toBeNull();
    expect(w).toHaveLength(5);
  });

  it('maps every phase combination', () => {
    const w: string[] = [];
    expect(mapPhase(['EARLY_PHASE1'], w)).toBe('Early Phase 1');
    expect(mapPhase(['PHASE2', 'PHASE1'], w)).toBe('Phase 1/2');
    expect(mapPhase(['PHASE2', 'PHASE3'], w)).toBe('Phase 2/3');
    expect(mapPhase(['PHASE4'], w)).toBe('Phase 4');
    expect(mapPhase(['NA'], w)).toBe('Not applicable');
    expect(mapPhase(undefined, w)).toBe('Not applicable');
    expect(w).toEqual([]);
    expect(mapPhase(['PHASE1', 'PHASE3'], w)).toBe('Phase 3');
    expect(w).toHaveLength(1);
  });

  it('maps statuses, and unknown ones to "unknown" with a warning', () => {
    const w: string[] = [];
    expect(mapStatus('ACTIVE_NOT_RECRUITING', w)).toBe('active_not_recruiting');
    expect(mapStatus('WITHDRAWN', w)).toBe('withdrawn');
    expect(w).toEqual([]);
    expect(mapStatus('NO_LONGER_AVAILABLE', w)).toBe('unknown');
    expect(w).toHaveLength(1);
  });

  it('unescapes registry markdown', () => {
    expect(unescapeMarkdown('HbA1c \\>= 7.0% and \\< 10.5%')).toBe(
      'HbA1c >= 7.0% and < 10.5%',
    );
  });

  it('turns a partial search record into a result row', () => {
    expect(studyToHit(bullets)).toEqual({
      nctId: 'NCT90000003',
      title: 'Exercise and circulating tumor markers in breast cancer',
      status: 'enrolling_by_invitation',
      phase: 'Phase 2',
      conditions: ['Breast Cancer'],
      sponsor: 'Example Cancer Center',
      minAge: 21,
      maxAge: 70,
      sex: 'female',
      lastUpdated: '2024-08-20',
    });
    expect(studyToHit({})).toBeNull();
  });
});
