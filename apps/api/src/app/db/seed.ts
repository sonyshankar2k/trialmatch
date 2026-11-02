/**
 * Demo data, added once to an empty database (SEED_DEMO_DATA=true).
 * All trials and patients are fictional. NCT99… ids are not real registrations.
 */
import type { CriterionInput, TrialCreateInput } from '@trialmatch/shared';
import * as argon2 from 'argon2';
import { count } from 'drizzle-orm';
import type { Db } from './database';
import { patients, trialCriteria, trials, users } from './schema';

export const DEMO_PASSWORD = 'trialmatch-demo';

const inc = (text: string): CriterionInput => ({ type: 'inclusion', text });
const exc = (text: string): CriterionInput => ({ type: 'exclusion', text });

const DEMO_TRIALS: (TrialCreateInput & { criteria: CriterionInput[] })[] = [
  {
    nctId: 'NCT99000001',
    title:
      'Once-weekly GLP-1 agonist vs placebo in adults with type 2 diabetes and obesity',
    condition: 'Type 2 diabetes',
    phase: 'Phase 3',
    status: 'recruiting',
    sponsor: 'Northwind Therapeutics',
    summary:
      '52-week randomized, double-blind study of HbA1c and body-weight change.',
    minAge: 18,
    maxAge: 75,
    sex: 'all',
    criteria: [
      inc('Diagnosis of type 2 diabetes for at least 6 months'),
      inc('HbA1c between 7.0% and 10.5%'),
      inc('BMI of 30 kg/m² or higher'),
      exc('Type 1 diabetes'),
      exc('eGFR below 30 mL/min/1.73m²'),
      exc('History of pancreatitis'),
    ],
  },
  {
    nctId: 'NCT99000002',
    title: 'Inhaled biologic add-on therapy for severe eosinophilic asthma',
    condition: 'Asthma',
    phase: 'Phase 2',
    status: 'recruiting',
    sponsor: 'Contoso Biologics',
    summary: 'Effect on annual exacerbation rate over 24 weeks.',
    minAge: 12,
    maxAge: 65,
    sex: 'all',
    criteria: [
      inc('Physician-diagnosed asthma for at least 12 months'),
      inc('Blood eosinophils of 300 cells/µL or more'),
      inc('Two or more exacerbations needing oral steroids in the past year'),
      exc('Current smoker or more than 10 pack-years'),
      exc('Other chronic lung disease such as COPD'),
    ],
  },
  {
    nctId: 'NCT99000003',
    title: 'Early-stage HER2-positive breast cancer: shorter adjuvant therapy',
    condition: 'Breast cancer',
    phase: 'Phase 3',
    status: 'active_not_recruiting',
    sponsor: 'Fabrikam Oncology Group',
    minAge: 18,
    sex: 'female',
    criteria: [
      inc(
        'Histologically confirmed HER2-positive invasive breast cancer, stage I–II',
      ),
      inc('LVEF of 55% or more'),
      exc('Metastatic disease'),
      exc('Prior anthracycline therapy'),
    ],
  },
  {
    title: 'Digital cognitive training for mild cognitive impairment',
    condition: 'Mild cognitive impairment',
    phase: 'Phase 2',
    status: 'not_yet_recruiting',
    sponsor: 'Tailspin University Hospital',
    minAge: 60,
    maxAge: 85,
    sex: 'all',
    criteria: [
      inc('MoCA score between 18 and 25'),
      inc('Has a study partner who sees the participant weekly'),
      exc('Diagnosis of dementia'),
    ],
  },
  {
    nctId: 'NCT99000005',
    title:
      'Oral anticoagulant dosing in atrial fibrillation with chronic kidney disease',
    condition: 'Atrial fibrillation',
    phase: 'Phase 4',
    status: 'completed',
    sponsor: 'Woodgrove Cardiology Network',
    minAge: 50,
    sex: 'all',
    criteria: [
      inc('Non-valvular atrial fibrillation'),
      inc('eGFR between 15 and 50 mL/min/1.73m²'),
      exc('Mechanical heart valve'),
      exc('Active bleeding'),
    ],
  },
];

const DEMO_PATIENTS = [
  {
    pseudonym: 'P-0001',
    age: 54,
    sex: 'female' as const,
    conditions: ['Type 2 diabetes', 'Obesity', 'Hypertension'],
    medications: ['Metformin 1000 mg twice daily', 'Lisinopril 10 mg'],
    notes:
      'T2D diagnosed 2019. HbA1c 8.2% (last month). BMI 33. eGFR 78. No history of pancreatitis.',
  },
  {
    pseudonym: 'P-0002',
    age: 31,
    sex: 'male' as const,
    conditions: ['Asthma'],
    medications: ['Budesonide/formoterol inhaler', 'Montelukast'],
    notes:
      'Asthma since childhood. Eosinophils 450 cells/µL. 3 oral-steroid courses in the past 12 months. Never smoked.',
  },
  {
    pseudonym: 'P-0003',
    age: 68,
    sex: 'male' as const,
    conditions: ['Atrial fibrillation', 'Chronic kidney disease stage 3'],
    medications: ['Apixaban 2.5 mg twice daily'],
    notes: 'Non-valvular AF. eGFR 41. No bleeding history.',
  },
  {
    pseudonym: 'P-0004',
    age: 72,
    sex: 'female' as const,
    conditions: ['Mild cognitive impairment'],
    medications: [],
    notes: 'MoCA 22. Lives with daughter, who joins visits.',
  },
];

export async function seedDemoData(db: Db): Promise<void> {
  const [{ n }] = await db.select({ n: count() }).from(users);
  if (n > 0) return; // only into an empty database

  const passwordHash = await argon2.hash(DEMO_PASSWORD);
  const [alice, bob] = await db
    .insert(users)
    .values([
      {
        email: 'alice@trialmatch.dev',
        displayName: 'Alice Chen',
        passwordHash,
      },
      { email: 'bob@trialmatch.dev', displayName: 'Bob Patel', passwordHash },
    ])
    .returning();

  for (const [i, { criteria, ...t }] of DEMO_TRIALS.entries()) {
    const [trial] = await db
      .insert(trials)
      .values({
        ...t,
        nctId: t.nctId ?? null,
        createdById: i % 2 ? bob.id : alice.id,
      })
      .returning();
    const next = { inclusion: 0, exclusion: 0 };
    await db.insert(trialCriteria).values(
      criteria.map((c) => ({
        trialId: trial.id,
        ...c,
        ordinal: ++next[c.type],
      })),
    );
  }
  await db
    .insert(patients)
    .values(DEMO_PATIENTS.map((p) => ({ ...p, ownerId: alice.id })));
}
