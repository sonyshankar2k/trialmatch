import { useTestApp } from '../../test/test-app';

const newTrial = (overrides: Record<string, unknown> = {}) => ({
  nctId: 'nct12345678',
  title: 'GLP-1 agonist in type 2 diabetes',
  condition: 'Type 2 diabetes',
  phase: 'Phase 3',
  status: 'recruiting',
  minAge: 18,
  maxAge: 75,
  criteria: [
    { type: 'inclusion', text: 'HbA1c 7–10.5%' },
    { type: 'exclusion', text: 'Type 1 diabetes' },
    { type: 'inclusion', text: 'BMI ≥ 30' },
  ],
  ...overrides,
});

describe('trials', () => {
  const t = useTestApp();

  it('creates a trial and numbers criteria within their type', async () => {
    const { auth } = await t.signUp();
    const res = await t
      .http()
      .post('/api/trials')
      .set(auth)
      .send(newTrial())
      .expect(201);
    expect(res.body).toMatchObject({
      nctId: 'NCT12345678',
      version: 1,
      createdBy: 'Test User',
      sex: 'all',
    });
    expect(res.body.criteria.map((c: { code: string }) => c.code)).toEqual([
      'I1',
      'I2',
      'E1',
    ]);
  });

  it('validates input, including cross-field rules', async () => {
    const { auth } = await t.signUp();
    const res = await t
      .http()
      .post('/api/trials')
      .set(auth)
      .send(
        newTrial({
          nctId: 'ABC',
          phase: 'Phase 9',
          minAge: 70,
          maxAge: 18,
          criteria: [{ type: 'inclusion', text: ' ' }],
        }),
      )
      .expect(400);
    expect(res.body.fieldErrors).toMatchObject({
      nctId: expect.any(String),
      phase: expect.any(String),
      'criteria.0.text': 'Required',
    });
  });

  it('rejects a min age above the max age', async () => {
    const { auth } = await t.signUp();
    const res = await t
      .http()
      .post('/api/trials')
      .set(auth)
      .send(newTrial({ minAge: 70, maxAge: 18 }))
      .expect(400);
    expect(res.body.fieldErrors.maxAge).toBe(
      'Must be at least the minimum age',
    );
  });

  it('reports a duplicate NCT ID on the field', async () => {
    const { auth } = await t.signUp();
    await t.http().post('/api/trials').set(auth).send(newTrial()).expect(201);
    const res = await t
      .http()
      .post('/api/trials')
      .set(auth)
      .send(newTrial())
      .expect(400);
    expect(res.body.fieldErrors.nctId).toMatch(/already uses/);
  });

  it('lists with search, filters and pagination', async () => {
    const { auth } = await t.signUp();
    await t.http().post('/api/trials').set(auth).send(newTrial()).expect(201);
    await t
      .http()
      .post('/api/trials')
      .set(auth)
      .send(
        newTrial({
          nctId: null,
          title: 'Asthma biologic',
          condition: 'Asthma',
          phase: 'Phase 2',
          criteria: [],
        }),
      )
      .expect(201);

    const all = await t
      .http()
      .get('/api/trials?pageSize=1')
      .set(auth)
      .expect(200);
    expect(all.body).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(all.body.items).toHaveLength(1);

    const search = await t
      .http()
      .get('/api/trials?search=asth')
      .set(auth)
      .expect(200);
    expect(search.body.items.map((x: { title: string }) => x.title)).toEqual([
      'Asthma biologic',
    ]);

    const phase = await t
      .http()
      .get('/api/trials?phase=Phase%203')
      .set(auth)
      .expect(200);
    expect(phase.body.items[0]).toMatchObject({
      nctId: 'NCT12345678',
      criteriaCount: 3,
    });

    // A % typed by the user is a literal character, not a wildcard.
    const literal = await t
      .http()
      .get('/api/trials?search=%25')
      .set(auth)
      .expect(200);
    expect(literal.body.total).toBe(0);
  });

  it('updates with optimistic concurrency: a stale version gets 409 and the current record', async () => {
    const { auth } = await t.signUp();
    const created = (
      await t.http().post('/api/trials').set(auth).send(newTrial()).expect(201)
    ).body;

    const first = await t
      .http()
      .patch(`/api/trials/${created.id}`)
      .set(auth)
      .send({ status: 'completed', version: 1 })
      .expect(200);
    expect(first.body).toMatchObject({
      status: 'completed',
      version: 2,
      title: created.title,
    });
    expect(first.body.criteria).toHaveLength(3); // untouched when not sent

    const stale = await t
      .http()
      .patch(`/api/trials/${created.id}`)
      .set(auth)
      .send({ title: 'Mine', version: 1 })
      .expect(409);
    expect(stale.body.current).toMatchObject({
      status: 'completed',
      version: 2,
    });
  });

  it('replaces criteria when sent, and deletes only with the current version', async () => {
    const { auth } = await t.signUp();
    const created = (
      await t.http().post('/api/trials').set(auth).send(newTrial()).expect(201)
    ).body;
    const updated = await t
      .http()
      .patch(`/api/trials/${created.id}`)
      .set(auth)
      .send({
        criteria: [{ type: 'exclusion', text: 'Pregnancy' }],
        version: 1,
      })
      .expect(200);
    expect(updated.body.criteria).toMatchObject([
      { code: 'E1', text: 'Pregnancy' },
    ]);

    await t
      .http()
      .delete(`/api/trials/${created.id}?version=1`)
      .set(auth)
      .expect(409);
    await t
      .http()
      .delete(`/api/trials/${created.id}?version=2`)
      .set(auth)
      .expect(204);
    await t.http().get(`/api/trials/${created.id}`).set(auth).expect(404);
  });

  it('never answers 500 for odd ids', async () => {
    const { auth } = await t.signUp();
    for (const id of ['abc', '0', '-1', '99999999999', '1.5']) {
      const res = await t.http().get(`/api/trials/${id}`).set(auth);
      expect(res.status).toBe(400);
    }
    await t.http().get('/api/trials/999').set(auth).expect(404);
  });
});
