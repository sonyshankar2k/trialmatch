import {
  decideEligibility,
  LoginSchema,
  PatientCreateSchema,
  TrialCreateSchema,
  TrialUpdateSchema,
} from '../index.js';

describe('shared schemas', () => {
  it('normalises emails before checking them', () => {
    expect(
      LoginSchema.parse({ email: '  Bob@Example.COM ', password: 'x' }).email,
    ).toBe('bob@example.com');
    expect(
      LoginSchema.safeParse({ email: 'nope', password: 'x' }).success,
    ).toBe(false);
  });

  it('applies trial defaults and upper-cases NCT ids', () => {
    const trial = TrialCreateSchema.parse({
      nctId: 'nct12345678',
      title: 'T',
      condition: 'C',
      phase: 'Phase 1',
      status: 'recruiting',
    });
    expect(trial).toMatchObject({
      nctId: 'NCT12345678',
      sex: 'all',
      criteria: [],
    });
  });

  it('checks the age range on create and on update', () => {
    const base = {
      title: 'T',
      condition: 'C',
      phase: 'Phase 1',
      status: 'recruiting',
    };
    const bad = TrialCreateSchema.safeParse({
      ...base,
      minAge: 65,
      maxAge: 18,
    });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0].path).toEqual(['maxAge']);
    expect(
      TrialUpdateSchema.safeParse({ minAge: 65, maxAge: 18, version: 1 })
        .success,
    ).toBe(false);
    expect(
      TrialUpdateSchema.safeParse({ title: 'New', version: 1 }).success,
    ).toBe(true);
  });

  it('rejects names as patient pseudonyms', () => {
    const patient = { age: 40, sex: 'female' };
    expect(
      PatientCreateSchema.safeParse({ ...patient, pseudonym: 'P-0042' })
        .success,
    ).toBe(true);
    expect(
      PatientCreateSchema.safeParse({ ...patient, pseudonym: 'Jane Smith' })
        .success,
    ).toBe(false);
  });
});

describe('decideEligibility', () => {
  const inc = (verdict: 'met' | 'not_met' | 'unknown') => ({
    type: 'inclusion' as const,
    verdict,
  });
  const exc = (verdict: 'met' | 'not_met' | 'unknown') => ({
    type: 'exclusion' as const,
    verdict,
  });

  it('is eligible only when every criterion points the right way', () => {
    expect(decideEligibility([inc('met'), exc('not_met')])).toEqual({
      eligibility: 'eligible',
      score: 100,
    });
  });

  it('needs review when anything is unknown', () => {
    expect(decideEligibility([inc('met'), exc('unknown')])).toEqual({
      eligibility: 'possibly_eligible',
      score: 50,
    });
  });

  it('is not eligible when an exclusion is met or an inclusion is not met, even with unknowns', () => {
    expect(decideEligibility([inc('met'), exc('met')]).eligibility).toBe(
      'not_eligible',
    );
    expect(
      decideEligibility([inc('not_met'), exc('unknown')]).eligibility,
    ).toBe('not_eligible');
    expect(
      decideEligibility([inc('met'), inc('met'), inc('met'), exc('met')]).score,
    ).toBeLessThanOrEqual(40);
  });

  it('handles a trial with no criteria', () => {
    expect(decideEligibility([])).toEqual({
      eligibility: 'eligible',
      score: 0,
    });
  });
});
