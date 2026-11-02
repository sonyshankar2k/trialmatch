import { useTestApp } from '../../test/test-app';

const newPatient = (overrides: Record<string, unknown> = {}) => ({
  pseudonym: 'P-0001',
  age: 54,
  sex: 'female',
  conditions: ['Type 2 diabetes', 'Hypertension'],
  medications: ['Metformin'],
  notes: 'HbA1c 8.2%',
  ...overrides,
});

describe('patients', () => {
  const t = useTestApp();

  it('creates, searches by condition, and updates', async () => {
    const { auth } = await t.signUp();
    const created = (
      await t
        .http()
        .post('/api/patients')
        .set(auth)
        .send(newPatient())
        .expect(201)
    ).body;
    await t
      .http()
      .post('/api/patients')
      .set(auth)
      .send(newPatient({ pseudonym: 'P-0002', conditions: ['Asthma'] }))
      .expect(201);

    const search = await t
      .http()
      .get('/api/patients?search=hypert')
      .set(auth)
      .expect(200);
    expect(
      search.body.items.map((p: { pseudonym: string }) => p.pseudonym),
    ).toEqual(['P-0001']);

    const updated = await t
      .http()
      .patch(`/api/patients/${created.id}`)
      .set(auth)
      .send({ age: 55, version: 1 })
      .expect(200);
    expect(updated.body).toMatchObject({
      age: 55,
      version: 2,
      conditions: ['Type 2 diabetes', 'Hypertension'],
    });
    await t
      .http()
      .patch(`/api/patients/${created.id}`)
      .set(auth)
      .send({ age: 56, version: 1 })
      .expect(409);
  });

  it("keeps each user's patients private (another user's id looks like it doesn't exist)", async () => {
    const alice = await t.signUp();
    const bob = await t.signUp();
    const created = (
      await t
        .http()
        .post('/api/patients')
        .set(alice.auth)
        .send(newPatient())
        .expect(201)
    ).body;

    await t.http().get(`/api/patients/${created.id}`).set(bob.auth).expect(404);
    await t
      .http()
      .patch(`/api/patients/${created.id}`)
      .set(bob.auth)
      .send({ age: 1, version: 1 })
      .expect(404);
    await t
      .http()
      .delete(`/api/patients/${created.id}?version=1`)
      .set(bob.auth)
      .expect(404);
    const bobsList = await t
      .http()
      .get('/api/patients')
      .set(bob.auth)
      .expect(200);
    expect(bobsList.body.total).toBe(0);

    // The same pseudonym is fine for a different user.
    await t
      .http()
      .post('/api/patients')
      .set(bob.auth)
      .send(newPatient())
      .expect(201);
  });

  it('rejects a real-looking name as a pseudonym, and duplicates per user', async () => {
    const { auth } = await t.signUp();
    const bad = await t
      .http()
      .post('/api/patients')
      .set(auth)
      .send(newPatient({ pseudonym: 'Jane Smith' }))
      .expect(400);
    expect(bad.body.fieldErrors.pseudonym).toMatch(/Never a real name/);

    await t
      .http()
      .post('/api/patients')
      .set(auth)
      .send(newPatient())
      .expect(201);
    const dup = await t
      .http()
      .post('/api/patients')
      .set(auth)
      .send(newPatient())
      .expect(400);
    expect(dup.body.fieldErrors.pseudonym).toMatch(/already have/);
  });
});
