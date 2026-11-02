import {
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
