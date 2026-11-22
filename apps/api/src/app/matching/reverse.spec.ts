import type { MatchRun } from '@trialmatch/shared';
import { DB } from '../db/database';
import { DEMO_PASSWORD, seedDemoData } from '../db/seed';
import { useTestApp } from '../../test/test-app';
import { InlineMatchQueue, MatchQueue } from './queue';

type Auth = Record<string, string>;

describe('finding patients for a trial (Week 7)', () => {
  const t = useTestApp();
  const drain = () => (t.app.get(MatchQueue) as InlineMatchQueue).drain();

  async function login(email: string): Promise<Auth> {
    const res = await t
      .http()
      .post('/api/auth/login')
      .send({ email, password: DEMO_PASSWORD })
      .expect(200);
    return { Authorization: `Bearer ${res.body.accessToken}` };
  }

  async function trialId(auth: Auth, nctId: string): Promise<number> {
    const res = await t
      .http()
      .get(`/api/trials?search=${nctId}`)
      .set(auth)
      .expect(200);
    return res.body.items[0].id;
  }

  async function addPatient(
    auth: Auth,
    body: { pseudonym: string; age: number; conditions: string[] },
  ): Promise<number> {
    const res = await t
      .http()
      .post('/api/patients')
      .set(auth)
      .send({ sex: 'female', ...body })
      .expect(201);
    return res.body.id;
  }

  async function run(auth: Auth, path: string): Promise<MatchRun> {
    const started = await t.http().post(path).set(auth).expect(202);
    await drain();
    return (
      await t
        .http()
        .get(`/api/match-runs/${started.body.id}`)
        .set(auth)
        .expect(200)
    ).body;
  }

  /** Alice and the diabetes trial (NCT99000001: ages 18–75, any sex). */
  async function setup() {
    await seedDemoData(t.app.get(DB));
    const alice = await login('alice@trialmatch.dev');
    return { alice, diabetes: await trialId(alice, 'NCT99000001') };
  }

  it('screens only your own patients who fit the trial', async () => {
    const { alice, diabetes } = await setup();
    // Punctuation in a condition is removed before the full-text search.
    await addPatient(alice, {
      pseudonym: 'P-0101',
      age: 50,
      conditions: ['Type-2 diabetes'],
    });
    await addPatient(alice, {
      pseudonym: 'P-0102',
      age: 80, // older than the trial allows
      conditions: ['Type 2 diabetes'],
    });
    const bob = await login('bob@trialmatch.dev');
    await addPatient(bob, {
      pseudonym: 'P-0201',
      age: 50,
      conditions: ['Type 2 diabetes'],
    });

    const screened = await run(alice, `/api/trials/${diabetes}/match-runs`);
    expect(screened).toMatchObject({
      kind: 'trial',
      trialId: diabetes,
      patientId: null,
      status: 'succeeded',
      stage: expect.stringMatching(/^2 patients checked: /),
    });
    expect(screened.results.map((r) => r.pseudonym).sort()).toEqual([
      'P-0001',
      'P-0101',
    ]);
    for (const r of screened.results) {
      expect(r.trialId).toBe(diabetes);
      expect(r.patientId).toEqual(expect.any(Number));
      expect(r.assessments.length).toBeGreaterThan(0);
    }

    // Bob's own screening of the same trial finds only his patient.
    const bobs = await run(bob, `/api/trials/${diabetes}/match-runs`);
    expect(bobs.results.map((r) => r.pseudonym)).toEqual(['P-0201']);
  });

  it('says so when none of your patients fit', async () => {
    await seedDemoData(t.app.get(DB));
    const bob = await login('bob@trialmatch.dev'); // has no patients
    const diabetes = await trialId(bob, 'NCT99000001');
    const screened = await run(bob, `/api/trials/${diabetes}/match-runs`);
    expect(screened).toMatchObject({
      status: 'succeeded',
      results: [],
      stage: 'None of your patients match this trial’s conditions, age and sex',
    });
  });

  it('only screens recruiting trials, and 404s for an unknown trial', async () => {
    const { alice } = await setup();
    const closed = await trialId(alice, 'NCT99000003'); // active, not recruiting
    const res = await t
      .http()
      .post(`/api/trials/${closed}/match-runs`)
      .set(alice)
      .expect(400);
    expect(res.body.message).toMatch(/Only recruiting/);
    await t.http().post('/api/trials/999999/match-runs').set(alice).expect(404);
    await t.http().get('/api/trials/999999/match-runs').set(alice).expect(404);
  });

  it('lists each user their own screening runs only', async () => {
    const { alice, diabetes } = await setup();
    const screened = await run(alice, `/api/trials/${diabetes}/match-runs`);

    const mine = await t
      .http()
      .get(`/api/trials/${diabetes}/match-runs`)
      .set(alice)
      .expect(200);
    expect(mine.body.map((r: MatchRun) => r.id)).toEqual([screened.id]);

    const bob = await login('bob@trialmatch.dev');
    const theirs = await t
      .http()
      .get(`/api/trials/${diabetes}/match-runs`)
      .set(bob)
      .expect(200);
    expect(theirs.body).toEqual([]);
    await t.http().get(`/api/match-runs/${screened.id}`).set(bob).expect(404);
    await t
      .http()
      .patch(`/api/match-results/${screened.results[0].id}`)
      .set(bob)
      .send({ decision: 'dismissed' })
      .expect(404);
  });

  it('saves a review on the pair, so the patient’s page and referral agree', async () => {
    const { alice, diabetes } = await setup();
    const p1 = (
      await t.http().get('/api/patients?search=P-0001').set(alice).expect(200)
    ).body.items[0].id;
    const before = await run(alice, `/api/patients/${p1}/match-runs`);

    const screened = await run(alice, `/api/trials/${diabetes}/match-runs`);
    const pair = screened.results.find((r) => r.patientId === p1);
    await t
      .http()
      .patch(`/api/match-results/${pair?.id}`)
      .set(alice)
      .send({ decision: 'shortlisted' })
      .expect(200);

    // The patient's existing run shows it without matching again…
    const runs = await t
      .http()
      .get(`/api/patients/${p1}/match-runs`)
      .set(alice)
      .expect(200);
    expect(runs.body[0].id).toBe(before.id);
    expect(
      runs.body[0].results.find(
        (r: { trialId: number }) => r.trialId === diabetes,
      ),
    ).toMatchObject({ decision: 'shortlisted' });

    // …and so does their referral summary.
    await t
      .http()
      .get(`/api/patients/${p1}/referral.pdf`)
      .set(alice)
      .expect(200);
  });

  it('shares reviews between both directions, latest saved review first', async () => {
    const { alice, diabetes } = await setup();
    const screened = await run(alice, `/api/trials/${diabetes}/match-runs`);
    const [pair] = screened.results; // P-0001 × the diabetes trial
    await t
      .http()
      .patch(`/api/match-results/${pair.id}`)
      .set(alice)
      .send({ decision: 'shortlisted', note: 'Seen in the trial screen.' })
      .expect(200);

    // The patient's own run carries the shortlist over…
    const patientRun = await run(
      alice,
      `/api/patients/${pair.patientId}/match-runs`,
    );
    expect(patientRun.kind).toBe('patient');
    const same = patientRun.results.find((r) => r.trialId === diabetes);
    expect(same).toMatchObject({
      decision: 'shortlisted',
      note: 'Seen in the trial screen.',
      pseudonym: 'P-0001',
    });

    // …and clearing it there wins over the older shortlist on the next screen.
    await t
      .http()
      .patch(`/api/match-results/${same?.id}`)
      .set(alice)
      .send({ decision: 'pending', note: null })
      .expect(200);
    const again = await run(alice, `/api/trials/${diabetes}/match-runs`);
    expect(
      again.results.find((r) => r.patientId === pair.patientId),
    ).toMatchObject({ decision: 'pending', note: null });
  });
});
