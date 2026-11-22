/**
 * Week 8: keeping imported trials in step with ClinicalTrials.gov, end to end
 * through the real app and database. The registry is a local stub server whose
 * records each test edits to play out a registry change.
 */
import type {
  RegistrySyncResult,
  Trial,
  TrialUpdate,
} from '@trialmatch/shared';
import { createServer, type Server } from 'node:http';
import { useTestApp } from '../../test/test-app';
import { eq } from 'drizzle-orm';
import { DB, type Db } from '../db/database';
import { trials } from '../db/schema';
import { CtgovClient } from './ctgov.client';

const NCT = 'NCT91000001';

interface StudyState {
  status: string;
  date: string;
  minAge: string;
  inclusion: string[];
  exclusion: string[];
}

const original = (): StudyState => ({
  status: 'RECRUITING',
  date: '2026-01-10',
  minAge: '18 Years',
  inclusion: ['Adults with moderate asthma', 'Uses an inhaled steroid'],
  exclusion: ['Current smoker'],
});

const registry = {
  study: original(),
  listed: true,
  down: false,
  requests: [] as URL[],
  server: null as Server | null,
};

function record(s: StudyState) {
  return {
    protocolSection: {
      identificationModule: {
        nctId: NCT,
        briefTitle: 'Breathing exercises for moderate asthma',
      },
      statusModule: {
        overallStatus: s.status,
        lastUpdatePostDateStruct: { date: s.date },
      },
      conditionsModule: { conditions: ['Asthma'] },
      designModule: { studyType: 'INTERVENTIONAL', phases: ['PHASE2'] },
      eligibilityModule: {
        sex: 'ALL',
        minimumAge: s.minAge,
        eligibilityCriteria: [
          'Inclusion Criteria:',
          '',
          ...s.inclusion.map((c) => `* ${c}`),
          '',
          'Exclusion Criteria:',
          '',
          ...s.exclusion.map((c) => `* ${c}`),
        ].join('\n'),
      },
    },
  };
}

beforeAll(async () => {
  registry.server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    registry.requests.push(url);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (registry.down) return send(503, { message: 'down' });
    if (url.pathname === `/api/v2/studies/${NCT}`)
      return registry.listed
        ? send(200, record(registry.study))
        : send(404, { message: 'not found' });
    if (url.pathname === '/api/v2/studies') {
      const ids = url.searchParams.get('filter.ids')?.split(',') ?? [];
      return send(200, {
        studies:
          registry.listed && ids.includes(NCT) ? [record(registry.study)] : [],
      });
    }
    send(404, {});
  });
  await new Promise<void>((resolve) =>
    registry.server?.listen(4599, '127.0.0.1', resolve),
  );
});
afterAll(() => new Promise((resolve) => registry.server?.close(resolve)));

describe('registry sync (Week 8)', () => {
  const t = useTestApp();

  beforeEach(() => {
    registry.study = original();
    registry.listed = true;
    registry.down = false;
    registry.requests = [];
    t.app.get(CtgovClient).clearCache();
  });

  async function imported() {
    const { auth } = await t.signUp();
    const res = await t
      .http()
      .post('/api/registry/imports')
      .send({ nctId: NCT })
      .set(auth)
      .expect(201);
    registry.requests = [];
    return { auth, trial: res.body as Trial };
  }

  const sync = async (auth: Record<string, string>) =>
    (await t.http().post('/api/registry/sync').set(auth).expect(200))
      .body as RegistrySyncResult;
  const getTrial = async (auth: Record<string, string>, id: number) =>
    (await t.http().get(`/api/trials/${id}`).set(auth).expect(200))
      .body as Trial;
  const pending = async (auth: Record<string, string>, id: number) =>
    (
      await t
        .http()
        .get(`/api/registry/trials/${id}/update`)
        .set(auth)
        .expect(200)
    ).body.update as TrialUpdate | null;

  it('asks only for dates when nothing changed', async () => {
    const { auth, trial } = await imported();
    expect(trial).toMatchObject({ pendingUpdateId: null });
    expect(trial.sourceCheckedAt).not.toBeNull();

    const result = await sync(auth);
    expect(result).toMatchObject({ checked: 1, updated: 0, failed: [] });
    // One batch request for dates; no full record fetched.
    expect(registry.requests.map((u) => u.pathname)).toEqual([
      '/api/v2/studies',
    ]);
    expect(registry.requests[0].searchParams.get('filter.ids')).toBe(NCT);
    expect(registry.requests[0].searchParams.get('fields')).toBe(
      'NCTId,LastUpdatePostDate',
    );
    expect(await pending(auth, trial.id)).toBeNull();
  });

  it('raises a pending update with the changed fields and criteria', async () => {
    const { auth, trial } = await imported();
    registry.study = {
      ...original(),
      status: 'ACTIVE_NOT_RECRUITING',
      date: '2026-03-02',
      minAge: '16 Years',
      inclusion: ['Adults with moderate asthma', 'Uses a daily inhaler'],
    };

    expect(await sync(auth)).toMatchObject({ checked: 1, updated: 1 });
    const update = await pending(auth, trial.id);
    expect(update).toMatchObject({
      trialId: trial.id,
      nctId: NCT,
      status: 'pending',
      revision: 1,
      registryLastUpdated: '2026-03-02',
      fields: [
        {
          field: 'status',
          current: 'recruiting',
          registry: 'active_not_recruiting',
        },
        { field: 'minAge', current: 18, registry: 16 },
      ],
      criteria: {
        added: [{ type: 'inclusion', text: 'Uses a daily inhaler' }],
        removed: [{ type: 'inclusion', text: 'Uses an inhaled steroid' }],
      },
    });
    // The trial itself is untouched until someone decides.
    const now = await getTrial(auth, trial.id);
    expect(now).toMatchObject({
      status: 'recruiting',
      minAge: 18,
      version: trial.version,
      pendingUpdateId: update?.id,
      sourceLastUpdated: '2026-01-10',
    });
    const list = await t.http().get('/api/trials').set(auth).expect(200);
    expect(list.body.items[0]).toMatchObject({ pendingUpdateId: update?.id });

    // A later registry change replaces the pending update instead of adding one.
    registry.study = {
      ...registry.study,
      date: '2026-03-09',
      minAge: '18 Years',
    };
    await sync(auth);
    const replaced = await pending(auth, trial.id);
    expect(replaced?.id).toBe(update?.id);
    expect(replaced?.revision).toBe(2);
    expect(replaced?.fields.map((f) => f.field)).toEqual(['status']);

    // Seeing the same change again (Check now) is not a new revision.
    await t
      .http()
      .post(`/api/registry/trials/${trial.id}/check`)
      .set(auth)
      .expect(200);
    expect((await pending(auth, trial.id))?.revision).toBe(2);
  });

  it('refuses a decision on a revision that was replaced while it was reviewed', async () => {
    const { auth, trial } = await imported();
    registry.study = { ...original(), status: 'SUSPENDED', date: '2026-03-02' };
    await sync(auth);
    const reviewed = (await pending(auth, trial.id)) as TrialUpdate;

    // Meanwhile the registry changes again and the daily check replaces it.
    registry.study = {
      ...registry.study,
      date: '2026-03-09',
      exclusion: ['Current smoker', 'Pregnancy'],
    };
    await sync(auth);

    for (const [path, body] of [
      ['apply', { revision: reviewed.revision, version: trial.version }],
      ['dismiss', { revision: reviewed.revision }],
    ] as const) {
      const res = await t
        .http()
        .post(`/api/registry/updates/${reviewed.id}/${path}`)
        .set(auth)
        .send(body)
        .expect(409);
      expect(res.body.message).toMatch(/changed this study again/);
    }
    // Nothing unseen was applied or kept.
    expect(await getTrial(auth, trial.id)).toMatchObject({
      status: 'recruiting',
      version: trial.version,
      sourceLastUpdated: '2026-01-10',
    });
    const latest = (await pending(auth, trial.id)) as TrialUpdate;
    expect(latest).toMatchObject({ status: 'pending', revision: 2 });
    expect(latest.criteria.added).toEqual([
      { type: 'exclusion', text: 'Pregnancy' },
    ]);

    // Reviewing the latest revision works.
    await t
      .http()
      .post(`/api/registry/updates/${latest.id}/apply`)
      .set(auth)
      .send({ revision: latest.revision, version: trial.version })
      .expect(200);
  });

  it('a check running alongside Apply neither re-raises the change nor breaks it', async () => {
    const { auth, trial } = await imported();
    registry.study = { ...original(), status: 'COMPLETED', date: '2026-04-01' };
    await sync(auth);
    const update = (await pending(auth, trial.id)) as TrialUpdate;
    const check = () =>
      t.http().post(`/api/registry/trials/${trial.id}/check`).set(auth);
    const apply = (version: number) =>
      t
        .http()
        .post(`/api/registry/updates/${update.id}/apply`)
        .set(auth)
        .send({ revision: update.revision, version });

    // A stale Apply fails with 409 (not a database error) and leaves the update pending.
    const [stale, checked] = await Promise.all([apply(99), check()]);
    expect(stale.status).toBe(409);
    expect(checked.status).toBe(200);
    expect(await pending(auth, trial.id)).toMatchObject({
      id: update.id,
      status: 'pending',
    });

    const [applied, after] = await Promise.all([apply(trial.version), check()]);
    expect(applied.status).toBe(200);
    expect(after.status).toBe(200);
    // Whichever ran second saw the other's result: nothing is left pending.
    expect(await pending(auth, trial.id)).toBeNull();
    expect(await getTrial(auth, trial.id)).toMatchObject({
      status: 'completed',
      pendingUpdateId: null,
    });
  });

  it('applies an update: registry values win, local edits elsewhere stay', async () => {
    const { auth, trial } = await imported();
    // A coordinator rewords one criterion and shortens the title here.
    const edited = (
      await t
        .http()
        .patch(`/api/trials/${trial.id}`)
        .set(auth)
        .send({
          version: trial.version,
          title: 'Breathing exercises (asthma)',
          criteria: [
            { type: 'inclusion', text: 'Adults (18+) with moderate asthma' },
            { type: 'inclusion', text: 'Uses an inhaled steroid' },
            { type: 'exclusion', text: 'Current smoker' },
          ],
        })
        .expect(200)
    ).body as Trial;
    registry.study = {
      ...original(),
      status: 'COMPLETED',
      date: '2026-04-01',
      exclusion: ['Current smoker', 'Pregnancy'],
    };
    await sync(auth);
    const update = (await pending(auth, trial.id)) as TrialUpdate;
    // The local title edit is not a registry change.
    expect(update.fields.map((f) => f.field)).toEqual(['status']);

    // A stale version is refused, and the update stays pending.
    await t
      .http()
      .post(`/api/registry/updates/${update.id}/apply`)
      .set(auth)
      .send({ revision: update.revision, version: trial.version })
      .expect(409);
    expect((await pending(auth, trial.id))?.id).toBe(update.id);

    const applied = (
      await t
        .http()
        .post(`/api/registry/updates/${update.id}/apply`)
        .set(auth)
        .send({ revision: update.revision, version: edited.version })
        .expect(200)
    ).body as Trial;
    expect(applied).toMatchObject({
      status: 'completed',
      title: 'Breathing exercises (asthma)',
      sourceLastUpdated: '2026-04-01',
      pendingUpdateId: null,
      version: edited.version + 1,
    });
    expect(applied.criteria.map((c) => `${c.code} ${c.text}`)).toEqual([
      'I1 Adults (18+) with moderate asthma',
      'I2 Uses an inhaled steroid',
      'E1 Current smoker',
      'E2 Pregnancy',
    ]);

    // In step now: the next sync raises nothing, and the update is history.
    expect(await sync(auth)).toMatchObject({ updated: 0 });
    const again = await t
      .http()
      .post(`/api/registry/updates/${update.id}/apply`)
      .set(auth)
      .send({ revision: update.revision, version: applied.version })
      .expect(409);
    expect(again.body.message).toMatch(/already applied/);
  });

  it('keeps the current version: nothing changes and the change is not raised again', async () => {
    const { auth, trial } = await imported();
    registry.study = { ...original(), status: 'SUSPENDED', date: '2026-05-05' };
    await sync(auth);
    const update = (await pending(auth, trial.id)) as TrialUpdate;

    const kept = (
      await t
        .http()
        .post(`/api/registry/updates/${update.id}/dismiss`)
        .set(auth)
        .send({ revision: update.revision })
        .expect(200)
    ).body as Trial;
    expect(kept).toMatchObject({
      status: 'recruiting',
      version: trial.version,
      sourceLastUpdated: '2026-05-05',
      pendingUpdateId: null,
    });
    expect(await sync(auth)).toMatchObject({ updated: 0 });
    expect(await pending(auth, trial.id)).toBeNull();
  });

  it('does not raise a change the trial already has', async () => {
    const { auth, trial } = await imported();
    await t
      .http()
      .patch(`/api/trials/${trial.id}`)
      .set(auth)
      .send({ version: trial.version, status: 'completed' })
      .expect(200);
    registry.study = { ...original(), status: 'COMPLETED', date: '2026-06-01' };

    expect(await sync(auth)).toMatchObject({ updated: 0 });
    expect(await getTrial(auth, trial.id)).toMatchObject({
      sourceLastUpdated: '2026-06-01',
      pendingUpdateId: null,
    });
  });

  it('checks one trial on demand, and only imported ones', async () => {
    const { auth, trial } = await imported();
    registry.study = { ...original(), status: 'COMPLETED', date: '2026-07-01' };
    const res = await t
      .http()
      .post(`/api/registry/trials/${trial.id}/check`)
      .set(auth)
      .expect(200);
    expect(res.body.update).toMatchObject({
      status: 'pending',
      trialId: trial.id,
    });

    const manual = await t
      .http()
      .post('/api/trials')
      .set(auth)
      .send({
        title: 'Typed in by hand',
        condition: 'Asthma',
        phase: 'Phase 2',
        status: 'recruiting',
      })
      .expect(201);
    await t
      .http()
      .post(`/api/registry/trials/${manual.body.id}/check`)
      .set(auth)
      .expect(400);
    await t
      .http()
      .post('/api/registry/trials/999999/check')
      .set(auth)
      .expect(404);
  });

  it('reports trials it could not check, and keeps them as they are', async () => {
    const { auth, trial } = await imported();
    registry.down = true;
    expect(await sync(auth)).toMatchObject({ checked: 1, failed: [NCT] });
    await t
      .http()
      .post(`/api/registry/trials/${trial.id}/check`)
      .set(auth)
      .expect(502);

    registry.down = false;
    registry.listed = false; // withdrawn from the registry
    expect(await sync(auth)).toMatchObject({ failed: [NCT], updated: 0 });
    expect(await getTrial(auth, trial.id)).toMatchObject({
      status: 'recruiting',
    });
  });

  it('compares trials imported before Week 8 with the trial itself', async () => {
    const { auth, trial } = await imported();
    // Week 5 imports have no snapshot.
    await t.app
      .get<Db>(DB)
      .update(trials)
      .set({ sourceSnapshot: null })
      .where(eq(trials.id, trial.id));
    expect(await sync(auth)).toMatchObject({ updated: 0 });
    // Now it has one, so the next unchanged sync only asks for dates.
    registry.requests = [];
    await sync(auth);
    expect(registry.requests).toHaveLength(1);
  });

  it('requires sign-in', async () => {
    await t.http().post('/api/registry/sync').expect(401);
    await t.http().post('/api/registry/updates/1/apply').expect(401);
  });
});
