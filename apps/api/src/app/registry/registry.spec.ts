/**
 * Registry import, end to end through the real app and database. ClinicalTrials.gov
 * is replaced by a small local HTTP server serving the fixture records, so the
 * tests are fast, offline and can make the registry fail on purpose.
 */
import type { MatchRun, RegistryPreview, Trial } from '@trialmatch/shared';
import { createServer, type Server } from 'node:http';
import { useTestApp } from '../../test/test-app';
import { InlineMatchQueue, MatchQueue } from '../matching/queue';
import { CtgovClient } from './ctgov.client';
import { fixture } from './fixtures/load';

const studies = {
  NCT90000001: fixture('cohorts'),
  NCT90000002: fixture('numbered'),
  NCT90000003: fixture('bullets'),
  NCT90000004: {
    protocolSection: {
      identificationModule: {
        nctId: 'NCT90000004',
        briefTitle: 'Compassionate use',
      },
      designModule: { studyType: 'EXPANDED_ACCESS' },
    },
  },
};

/** Stub ClinicalTrials.gov: records every request; `mode` makes it misbehave. */
const registry = {
  requests: [] as URL[],
  mode: 'ok' as 'ok' | 'error' | 'slow' | 'rejectNarrowing',
  server: null as Server | null,
};

beforeAll(async () => {
  registry.server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    registry.requests.push(url);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (registry.mode === 'error') return send(503, { message: 'down' });
    if (registry.mode === 'slow')
      return void setTimeout(() => send(200, {}), 1500);
    const one = url.pathname.match(/^\/api\/v2\/studies\/(NCT\d{8})$/);
    if (one) {
      const study = studies[one[1] as keyof typeof studies];
      return study ? send(200, study) : send(404, { message: 'not found' });
    }
    if (url.pathname === '/api/v2/studies') {
      if (
        registry.mode === 'rejectNarrowing' &&
        url.searchParams.has('fields')
      ) {
        return send(400, { message: 'unknown field' });
      }
      return send(200, {
        studies: [studies.NCT90000001, studies.NCT90000003],
        totalCount: 42,
        nextPageToken: url.searchParams.has('pageToken') ? undefined : 'NEXT-1',
      });
    }
    send(404, {});
  });
  await new Promise<void>((resolve) =>
    registry.server?.listen(4599, '127.0.0.1', resolve),
  );
});
afterAll(() => new Promise((resolve) => registry.server?.close(resolve)));

describe('registry import', () => {
  const t = useTestApp();

  beforeEach(() => {
    registry.requests = [];
    registry.mode = 'ok';
    t.app.get(CtgovClient).clearCache();
  });

  it('requires sign-in', async () => {
    await t.http().get('/api/registry/studies?condition=asthma').expect(401);
    await t
      .http()
      .post('/api/registry/imports')
      .send({ nctId: 'NCT90000001' })
      .expect(401);
  });

  it('searches the registry for interventional studies', async () => {
    const { auth } = await t.signUp();
    const res = await t
      .http()
      .get('/api/registry/studies?condition=asthma&term=exercise')
      .set(auth)
      .expect(200);
    expect(res.body).toMatchObject({ total: 42, nextPageToken: 'NEXT-1' });
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0]).toMatchObject({
      nctId: 'NCT90000001',
      status: 'recruiting',
      phase: 'Not applicable',
      minAge: 12,
      importedTrialId: null,
    });

    const sent = registry.requests[0].searchParams;
    expect(sent.get('query.cond')).toBe('asthma');
    expect(sent.get('query.term')).toBe('exercise');
    expect(sent.get('filter.overallStatus')).toBe('RECRUITING');
    expect(sent.get('filter.advanced')).toBe('AREA[StudyType]INTERVENTIONAL');
    expect(sent.get('fields')).toContain('NCTId');
    expect(sent.get('pageSize')).toBe('10');
    expect(sent.get('countTotal')).toBe('true');

    await t
      .http()
      .get('/api/registry/studies?condition=asthma&status=any&pageToken=NEXT-1')
      .set(auth)
      .expect(200);
    const next = registry.requests[1].searchParams;
    expect(next.get('pageToken')).toBe('NEXT-1');
    expect(next.has('filter.overallStatus')).toBe(false);
    expect(next.has('countTotal')).toBe(false);
  });

  it('validates search input before calling the registry', async () => {
    const { auth } = await t.signUp();
    const empty = await t
      .http()
      .get('/api/registry/studies')
      .set(auth)
      .expect(400);
    expect(empty.body.fieldErrors).toEqual({
      condition: 'Enter a condition or a search term',
    });
    await t
      .http()
      .get('/api/registry/studies?condition=x&pageToken=bad%20token%26x=1')
      .set(auth)
      .expect(400);
    await t.http().get('/api/registry/studies/NCT123').set(auth).expect(400);
    expect(registry.requests).toHaveLength(0);
  });

  it('falls back to a plain search if the registry rejects the narrowing options', async () => {
    const { auth } = await t.signUp();
    registry.mode = 'rejectNarrowing';
    const res = await t
      .http()
      .get('/api/registry/studies?term=asthma')
      .set(auth)
      .expect(200);
    expect(res.body.items).toHaveLength(2);
    expect(registry.requests).toHaveLength(2);
    expect(registry.requests[1].searchParams.has('fields')).toBe(false);
  });

  it('previews a study without saving it', async () => {
    const { auth } = await t.signUp();
    const res = await t
      .http()
      .get('/api/registry/studies/nct90000002') // case-insensitive
      .set(auth)
      .expect(200);
    const preview = res.body as RegistryPreview;
    expect(preview).toMatchObject({
      nctId: 'NCT90000002',
      lastUpdated: '2025-03-02',
      warnings: [],
      importedTrialId: null,
      trial: { phase: 'Phase 1/2', status: 'completed', minAge: 18 },
    });
    expect(preview.trial.criteria).toHaveLength(18);
    expect(preview.sourceCriteriaText).toMatch(/^Inclusion Criteria:/);
    const trials = await t.http().get('/api/trials').set(auth).expect(200);
    expect(trials.body.total).toBe(0);
  });

  it('imports a study as a trial, once', async () => {
    const { auth } = await t.signUp();
    const res = await t
      .http()
      .post('/api/registry/imports')
      .set(auth)
      .send({ nctId: 'NCT90000001' })
      .expect(201);
    const trial = res.body as Trial;
    expect(trial).toMatchObject({
      nctId: 'NCT90000001',
      source: 'clinicaltrials_gov',
      sourceLastUpdated: '2026-10-14',
      status: 'recruiting',
      version: 1,
      createdBy: 'Test User',
    });
    expect(trial.criteria.map((c) => c.code).slice(0, 3)).toEqual([
      'I1',
      'I2',
      'I3',
    ]);
    expect(trial.criteria.filter((c) => c.type === 'exclusion')).toHaveLength(
      19,
    );
    // Previewed and imported from one registry call (cached).
    expect(registry.requests).toHaveLength(1);

    const again = await t
      .http()
      .post('/api/registry/imports')
      .set(auth)
      .send({ nctId: 'nct90000001' })
      .expect(409);
    expect(again.body).toEqual({
      statusCode: 409,
      message: 'NCT90000001 is already in TrialMatch.',
      current: { id: trial.id },
    });

    // Search results and previews point at the imported trial.
    const search = await t
      .http()
      .get('/api/registry/studies?condition=asthma')
      .set(auth);
    expect(search.body.items[0].importedTrialId).toBe(trial.id);
    const preview = await t
      .http()
      .get('/api/registry/studies/NCT90000001')
      .set(auth);
    expect(preview.body.importedTrialId).toBe(trial.id);

    // An imported trial is an ordinary trial: it can be edited and keeps its source.
    const edited = await t
      .http()
      .patch(`/api/trials/${trial.id}`)
      .set(auth)
      .send({ title: 'Edited title', version: 1 })
      .expect(200);
    expect(edited.body).toMatchObject({
      source: 'clinicaltrials_gov',
      version: 2,
    });
  });

  it('marks trials typed in by hand as manual', async () => {
    const { auth } = await t.signUp();
    const res = await t
      .http()
      .post('/api/trials')
      .set(auth)
      .send({
        title: 'Hand-made',
        condition: 'Asthma',
        phase: 'Phase 2',
        status: 'recruiting',
      })
      .expect(201);
    expect(res.body).toMatchObject({
      source: 'manual',
      sourceLastUpdated: null,
    });
  });

  it('feeds imported trials into matching', async () => {
    const { auth } = await t.signUp();
    await t
      .http()
      .post('/api/registry/imports')
      .set(auth)
      .send({ nctId: 'NCT90000001' })
      .expect(201);
    const patient = await t
      .http()
      .post('/api/patients')
      .set(auth)
      .send({
        pseudonym: 'P-EIA1',
        age: 15,
        sex: 'male',
        conditions: ['Exercise induced asthma'],
      })
      .expect(201);
    const started = await t
      .http()
      .post(`/api/patients/${patient.body.id}/match-runs`)
      .set(auth)
      .expect(202);
    await (t.app.get(MatchQueue) as InlineMatchQueue).drain();
    const run: MatchRun = (
      await t
        .http()
        .get(`/api/match-runs/${started.body.id}`)
        .set(auth)
        .expect(200)
    ).body;
    expect(run.status).toBe('succeeded');
    expect(run.results.map((r) => r.nctId)).toEqual(['NCT90000001']);
    expect(run.results[0].assessments).toHaveLength(27);
  });

  it('explains studies that cannot be imported', async () => {
    const { auth } = await t.signUp();
    const missing = await t
      .http()
      .get('/api/registry/studies/NCT90000099')
      .set(auth)
      .expect(404);
    expect(missing.body).toEqual({
      statusCode: 404,
      message: "NCT90000099 isn't on ClinicalTrials.gov. Check the NCT ID.",
    });
    const expanded = await t
      .http()
      .post('/api/registry/imports')
      .set(auth)
      .send({ nctId: 'NCT90000004' })
      .expect(422);
    expect(expanded.body).toEqual({
      statusCode: 422,
      message: expect.stringMatching(/expanded access program/),
    });
  });

  it('returns 502 with a clear message when the registry is down or slow', async () => {
    const { auth } = await t.signUp();
    const message = "ClinicalTrials.gov didn't respond. Try again in a minute.";
    registry.mode = 'error';
    const down = await t
      .http()
      .get('/api/registry/studies?term=asthma')
      .set(auth)
      .expect(502);
    expect(down.body).toEqual({ statusCode: 502, message });
    registry.mode = 'slow';
    const slow = await t
      .http()
      .post('/api/registry/imports')
      .set(auth)
      .send({ nctId: 'NCT90000003' })
      .expect(502);
    expect(slow.body.message).toBe(message);
    const trials = await t.http().get('/api/trials').set(auth).expect(200);
    expect(trials.body.total).toBe(0);
  });
});
