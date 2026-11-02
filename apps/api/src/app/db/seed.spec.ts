import { DB } from './database';
import { DEMO_PASSWORD, seedDemoData } from './seed';
import { useTestApp } from '../../test/test-app';

describe('demo data', () => {
  const t = useTestApp();

  it('seeds an empty database once, and the demo login works', async () => {
    const db = t.app.get(DB);
    await seedDemoData(db);
    await seedDemoData(db); // second run is a no-op

    const login = await t
      .http()
      .post('/api/auth/login')
      .send({ email: 'alice@trialmatch.dev', password: DEMO_PASSWORD })
      .expect(200);
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };
    const trials = await t.http().get('/api/trials').set(auth).expect(200);
    expect(trials.body.total).toBe(5);
    const patients = await t.http().get('/api/patients').set(auth).expect(200);
    expect(patients.body.total).toBe(4);
  });
});
