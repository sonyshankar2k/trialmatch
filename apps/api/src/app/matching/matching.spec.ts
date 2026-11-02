import type { MatchRun } from '@trialmatch/shared';
import { DB } from '../db/database';
import { DEMO_PASSWORD, seedDemoData } from '../db/seed';
import { useTestApp } from '../../test/test-app';
import { InMemoryMatchEvents } from './events';
import { MatchQueue, InlineMatchQueue } from './queue';
import { TransientMatchError, type MatchEngine } from './engines';
import { MatchRunner } from './runner';

describe('matching', () => {
  const t = useTestApp();

  async function signIn(email: string) {
    await seedDemoData(t.app.get(DB));
    const res = await t
      .http()
      .post('/api/auth/login')
      .send({ email, password: DEMO_PASSWORD })
      .expect(200);
    return { Authorization: `Bearer ${res.body.accessToken}` };
  }
  async function patientId(
    auth: Record<string, string>,
    pseudonym: string,
  ): Promise<number> {
    const res = await t
      .http()
      .get(`/api/patients?search=${pseudonym}`)
      .set(auth)
      .expect(200);
    return res.body.items[0].id;
  }
  const drain = () => (t.app.get(MatchQueue) as InlineMatchQueue).drain();

  it('finds candidate trials and assesses every criterion', async () => {
    const auth = await signIn('alice@trialmatch.dev');
    const id = await patientId(auth, 'P-0001');

    const started = await t
      .http()
      .post(`/api/patients/${id}/match-runs`)
      .set(auth)
      .expect(202);
    expect(started.body).toMatchObject({ status: 'queued', results: [] });
    await drain();

    const run: MatchRun = (
      await t
        .http()
        .get(`/api/match-runs/${started.body.id}`)
        .set(auth)
        .expect(200)
    ).body;
    expect(run).toMatchObject({
      status: 'succeeded',
      progress: 100,
      engine: 'rules',
    });
    expect(run.results.map((r) => r.nctId)).toEqual(['NCT99000001']); // the diabetes trial only
    const [result] = run.results;
    expect(result.eligibility).toBe('possibly_eligible');
    expect(result.assessments.map((a) => `${a.code}:${a.verdict}`)).toEqual([
      'I1:met',
      'I2:met', // the notes mention HbA1c (8.2%, in range); the reason asks a person to confirm
      'I3:unknown',
      'E1:unknown',
      'E2:unknown',
      'E3:not_met',
    ]);
    expect(run.stage).toBe('1 trial checked: 0 likely eligible, 1 need review');

    const history = await t
      .http()
      .get(`/api/patients/${id}/match-runs`)
      .set(auth)
      .expect(200);
    expect(history.body.map((r: MatchRun) => r.id)).toEqual([run.id]);
  });

  it('skips completed trials and those outside the age range or sex', async () => {
    const auth = await signIn('alice@trialmatch.dev');
    // P-0003 has atrial fibrillation, but that trial is completed.
    const id = await patientId(auth, 'P-0003');
    const started = await t
      .http()
      .post(`/api/patients/${id}/match-runs`)
      .set(auth)
      .expect(202);
    await drain();
    const run = (
      await t
        .http()
        .get(`/api/match-runs/${started.body.id}`)
        .set(auth)
        .expect(200)
    ).body;
    expect(run).toMatchObject({ status: 'succeeded', results: [] });
    expect(run.stage).toMatch(/No recruiting trials match/);
  });

  it('streams the run as server-sent events and ends when it finishes', async () => {
    const auth = await signIn('alice@trialmatch.dev');
    const id = await patientId(auth, 'P-0002');
    const started = await t
      .http()
      .post(`/api/patients/${id}/match-runs`)
      .set(auth)
      .expect(202);
    await drain();

    const res = await t
      .http()
      .get(`/api/match-runs/${started.body.id}/events`)
      .set(auth)
      .buffer(true)
      .parse((r, cb) => {
        let text = '';
        r.on('data', (chunk: Buffer) => (text += chunk.toString()));
        r.on('end', () => cb(null, text));
      })
      .expect(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const events = (res.body as string)
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => JSON.parse(l.slice(6)));
    expect(events.at(-1)).toMatchObject({
      type: 'run',
      run: { status: 'succeeded' },
    });
    expect(events.at(-1).run.results[0].title).toMatch(/asthma/);
  });

  it("keeps runs private to the patient's owner", async () => {
    const alice = await signIn('alice@trialmatch.dev');
    const bobRes = await t
      .http()
      .post('/api/auth/login')
      .send({ email: 'bob@trialmatch.dev', password: DEMO_PASSWORD })
      .expect(200);
    const bob = { Authorization: `Bearer ${bobRes.body.accessToken}` };
    const id = await patientId(alice, 'P-0001');

    await t.http().post(`/api/patients/${id}/match-runs`).set(bob).expect(404);
    const started = await t
      .http()
      .post(`/api/patients/${id}/match-runs`)
      .set(alice)
      .expect(202);
    await drain();
    await t
      .http()
      .get(`/api/match-runs/${started.body.id}`)
      .set(bob)
      .expect(404);
    await t
      .http()
      .get(`/api/match-runs/${started.body.id}/events`)
      .set(bob)
      .expect(404);
    expect(
      (
        await t
          .http()
          .get(`/api/patients/${id}/match-runs`)
          .set(bob)
          .expect(200)
      ).body,
    ).toEqual([]);
  });

  it('retries transient failures, then gives up with a clear message', async () => {
    const auth = await signIn('alice@trialmatch.dev');
    const id = await patientId(auth, 'P-0001');
    const flaky: MatchEngine = {
      name: 'claude',
      assess: async () => {
        throw new TransientMatchError(
          'The AI service is busy or unreachable (429)',
        );
      },
    };
    const events = new InMemoryMatchEvents();
    const seen: MatchRun[] = [];
    const runner = new MatchRunner(t.app.get(DB), flaky, events, {
      maxTrials: 5,
      stepDelayMs: 0,
    });
    const queue = new InlineMatchQueue(
      (runId, attempt) => runner.run(runId, attempt),
      0,
    );

    const started = await t
      .http()
      .post(`/api/patients/${id}/match-runs`)
      .set(auth)
      .expect(202);
    await drain(); // the app's own run (rules engine) finishes first; reset it to retry with the flaky engine
    await t.app
      .get(DB)
      .execute(
        `update match_runs set status = 'queued' where id = ${Number(started.body.id)}` as never,
      );
    events.subscribe(started.body.id, (r) => seen.push(r));
    await queue.enqueue(started.body.id);
    await queue.drain();

    const run = (
      await t
        .http()
        .get(`/api/match-runs/${started.body.id}`)
        .set(auth)
        .expect(200)
    ).body;
    expect(run).toMatchObject({
      status: 'failed',
      error: 'The AI service is busy or unreachable (429)',
    });
    expect(
      seen.filter((r) => r.stage.includes('Trying again')).map((r) => r.stage),
    ).toEqual([
      'The AI service is busy or unreachable (429). Trying again shortly (attempt 2 of 3)',
      'The AI service is busy or unreachable (429). Trying again shortly (attempt 3 of 3)',
    ]);
  });
});
