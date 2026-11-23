/**
 * Week 9: the audit trail, through the real app and database.
 */
import type { AuditEvent, MatchRun, Page, Patient } from '@trialmatch/shared';
import { Pool } from 'pg';
import { useTestApp } from '../../test/test-app';
import { DB } from '../db/database';
import { DEMO_PASSWORD, seedDemoData } from '../db/seed';
import { InlineMatchQueue, MatchQueue } from '../matching/queue';
import { toCsv } from './audit.service';

type Auth = Record<string, string>;

describe('audit trail (Week 9)', () => {
  const t = useTestApp();

  async function login(email: string): Promise<Auth> {
    const res = await t
      .http()
      .post('/api/auth/login')
      .send({ email, password: DEMO_PASSWORD })
      .expect(200);
    return { Authorization: `Bearer ${res.body.accessToken}` };
  }

  /** Demo data: Alice is the demo admin, Bob a coordinator. */
  async function demo() {
    await seedDemoData(t.app.get(DB));
    return {
      alice: await login('alice@trialmatch.dev'),
      bob: await login('bob@trialmatch.dev'),
    };
  }

  const log = async (auth: Auth, query: Record<string, string> = {}) =>
    (await t.http().get('/api/audit').query(query).set(auth).expect(200))
      .body as Page<AuditEvent>;

  const patientHistory = async (auth: Auth, id: number) =>
    (await t.http().get(`/api/patients/${id}/history`).set(auth).expect(200))
      .body as AuditEvent[];

  it('records a patient’s life, with the request it came from, and notes redacted', async () => {
    const { bob } = await demo();
    const created = (
      await t
        .http()
        .post('/api/patients')
        .set(bob)
        .set('X-Request-Id', 'req-create-1')
        .send({
          pseudonym: 'P-0900',
          age: 40,
          sex: 'male',
          conditions: ['Asthma'],
          medications: [],
          notes: 'Lives with daughter; prefers mornings',
        })
        .expect(201)
    ).body as Patient;
    await t.http().get(`/api/patients/${created.id}`).set(bob).expect(200);
    const updated = (
      await t
        .http()
        .patch(`/api/patients/${created.id}`)
        .set(bob)
        .send({ version: created.version, age: 41, notes: 'Moved house' })
        .expect(200)
    ).body as Patient;

    const history = await patientHistory(bob, created.id);
    expect(history.map((e) => e.action)).toEqual([
      'patient.update',
      'patient.view',
      'patient.create',
    ]);
    const [edit, view, create] = history;
    expect(edit).toMatchObject({
      actor: { name: 'Bob Patel' },
      entityType: 'patient',
      entityId: created.id,
      label: 'P-0900',
      patientId: created.id,
      changes: [
        { field: 'age', from: 40, to: 41 },
        { field: 'notes', redacted: true },
      ],
      details: { version: updated.version },
    });
    expect(view.changes).toEqual([]);
    expect(create.requestId).toBe('req-create-1');
    expect(create.ip).toBeTruthy();
    // The notes never reach the log, in any event.
    expect(JSON.stringify(history)).not.toMatch(/daughter|Moved house/);

    // Deleting keeps the history (the record is gone, its events are not).
    await t
      .http()
      .delete(`/api/patients/${created.id}?version=${updated.version}`)
      .set(bob)
      .expect(204);
    await t
      .http()
      .get(`/api/patients/${created.id}/history`)
      .set(bob)
      .expect(404);
    const admin = await login('alice@trialmatch.dev');
    const kept = await log(admin, { patientId: String(created.id) });
    expect(kept.items.map((e) => e.action)).toEqual([
      'patient.delete',
      'patient.update',
      'patient.view',
      'patient.create',
    ]);
    expect(kept.items[0]).toMatchObject({ label: 'P-0900' });
  });

  it('records nothing for a change that did not happen', async () => {
    const { alice } = await demo();
    const patients = (
      await t.http().get('/api/patients').set(alice).expect(200)
    ).body.items as Patient[];
    const p = patients[0];
    const before = await log(alice, { action: 'patient.update' });
    await t
      .http()
      .patch(`/api/patients/${p.id}`)
      .set(alice)
      .send({ version: p.version + 5, age: 30 })
      .expect(409);
    // Another owner's patient behaves like a missing one, and leaves no trace either.
    const bob = await login('bob@trialmatch.dev');
    await t.http().get(`/api/patients/${p.id}`).set(bob).expect(404);
    expect((await log(alice, { action: 'patient.update' })).total).toBe(
      before.total,
    );
    expect(
      (await log(alice, { action: 'patient.view', actor: 'Bob' })).total,
    ).toBe(0);
  });

  it('is append-only in the database itself', async () => {
    await demo();
    const pool = t.app.get(Pool);
    await expect(
      pool.query(`UPDATE audit_events SET action = 'auth.register'`),
    ).rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM audit_events')).rejects.toThrow(
      /append-only/,
    );
  });

  it('records sign-ins and failed attempts, without the password', async () => {
    const { alice } = await demo();
    await t
      .http()
      .post('/api/auth/login')
      .send({ email: 'bob@trialmatch.dev', password: 'not-the-password' })
      .expect(401);
    await t
      .http()
      .post('/api/auth/login')
      .send({ email: 'nobody@trialmatch.dev', password: 'whatever-123' })
      .expect(401);

    const failed = await log(alice, { action: 'auth.login_failed' });
    expect(failed.items.map((e) => [e.label, e.actor])).toEqual([
      ['nobody@trialmatch.dev', null],
      ['bob@trialmatch.dev', null],
    ]);
    expect(JSON.stringify(failed)).not.toMatch(/not-the-password|whatever/);
    const signIns = await log(alice, { action: 'auth.login', actor: 'bob@' });
    expect(signIns.items).toHaveLength(1);
    expect(signIns.items[0].actor?.name).toBe('Bob Patel');
  });

  it('shows the full log and export to administrators only', async () => {
    const { alice, bob } = await demo();
    await t.http().get('/api/audit').set(bob).expect(403);
    await t.http().get('/api/audit/export.csv').set(bob).expect(403);
    await t.http().get('/api/audit').expect(401);
    expect((await log(alice)).total).toBeGreaterThan(0);

    // ADMIN_EMAILS (admin@test.dev in tests) makes an administrator at sign-up.
    const res = await t
      .http()
      .post('/api/auth/register')
      .send({
        email: 'admin@test.dev',
        displayName: 'Ada Admin',
        password: 'correct-horse-battery',
      })
      .expect(201);
    expect(res.body.user.role).toBe('admin');
    await t
      .http()
      .get('/api/audit')
      .set({ Authorization: `Bearer ${res.body.accessToken}` })
      .expect(200);
  });

  it('exports the filtered log as CSV, and records the export', async () => {
    const { alice } = await demo();
    const res = await t
      .http()
      .get('/api/audit/export.csv')
      .query({ action: 'auth.login' })
      .set(alice)
      .expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="audit-log-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toBe(
      'id,at,actor_id,actor,action,entity_type,entity_id,label,patient_id,trial_id,changes,details,request_id,ip',
    );
    expect(lines).toHaveLength(3); // Alice and Bob signed in
    expect(lines.slice(1).every((l) => l.includes(',auth.login,'))).toBe(true);

    const exports = await log(alice, { action: 'audit.export' });
    expect(exports.items[0]).toMatchObject({
      actor: { name: 'Alice Chen' },
      details: { filters: { action: 'auth.login' }, rows: 2 },
    });
  });

  it('keeps someone else’s patients out of a trial’s history', async () => {
    const { alice, bob } = await demo();
    const trial = (
      await t
        .http()
        .get('/api/trials?search=NCT99000001')
        .set(alice)
        .expect(200)
    ).body.items[0];
    // Alice screens her patients for the trial and shortlists one.
    const started = await t
      .http()
      .post(`/api/trials/${trial.id}/match-runs`)
      .set(alice)
      .expect(202);
    await (t.app.get(MatchQueue) as InlineMatchQueue).drain();
    const run = (
      await t
        .http()
        .get(`/api/match-runs/${started.body.id}`)
        .set(alice)
        .expect(200)
    ).body as MatchRun;
    const result = run.results[0];
    await t
      .http()
      .patch(`/api/match-results/${result.id}`)
      .set(alice)
      .send({ decision: 'shortlisted', note: 'Call about the morning visit' })
      .expect(200);
    // Bob edits the trial.
    await t
      .http()
      .patch(`/api/trials/${trial.id}`)
      .set(bob)
      .send({
        version: trial.version,
        status: 'active_not_recruiting',
      })
      .expect(200);

    const history = async (auth: Auth) =>
      (
        (
          await t
            .http()
            .get(`/api/trials/${trial.id}/history`)
            .set(auth)
            .expect(200)
        ).body as AuditEvent[]
      ).map((e) => e.action);
    // (Demo trials are seeded straight into the database, so they have no "created" event.)
    expect(await history(alice)).toEqual([
      'trial.update',
      'match.review',
      'match.start',
    ]);
    expect(await history(bob)).toEqual(['trial.update', 'match.start']);

    const review = (await patientHistory(alice, result.patientId as number))[0];
    expect(review).toMatchObject({
      action: 'match.review',
      trialId: trial.id,
      changes: [
        { field: 'decision', from: 'pending', to: 'shortlisted' },
        { field: 'note', redacted: true },
      ],
    });
    const edit = (await log(alice, { action: 'trial.update' })).items[0];
    expect(edit).toMatchObject({
      actor: { name: 'Bob Patel' },
      changes: [
        { field: 'status', from: 'recruiting', to: 'active_not_recruiting' },
      ],
    });
    await t.http().get('/api/trials/999999/history').set(alice).expect(404);
  });

  it('filters by day, and rejects a malformed one', async () => {
    const { alice } = await demo();
    const today = new Date().toISOString().slice(0, 10);
    expect(
      (await log(alice, { from: today, to: today })).total,
    ).toBeGreaterThan(0);
    expect((await log(alice, { to: '2000-01-01' })).total).toBe(0);
    await t.http().get('/api/audit?from=yesterday').set(alice).expect(400);
  });
});

describe('audit CSV', () => {
  it('quotes cells and defuses spreadsheet formulas', () => {
    const csv = toCsv([
      {
        id: 1,
        at: '2026-11-21T10:00:00.000Z',
        actor: { id: 2, name: 'Smith, "Jo"' },
        action: 'patient.create',
        entityType: 'patient',
        entityId: 3,
        label: '=HYPERLINK("http://x")',
        patientId: 3,
        trialId: null,
        changes: [{ field: 'age', from: null, to: 40 }],
        details: {},
        requestId: null,
        ip: null,
      },
    ]);
    const row = csv.split('\r\n')[1];
    expect(row).toContain('"Smith, ""Jo"""');
    expect(row).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(row).toContain('"[{""field"":""age"",""from"":null,""to"":40}]"');
  });
});
