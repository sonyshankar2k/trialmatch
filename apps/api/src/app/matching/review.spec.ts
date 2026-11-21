import type { MatchResult, MatchRun } from '@trialmatch/shared';
import { DB } from '../db/database';
import { DEMO_PASSWORD, seedDemoData } from '../db/seed';
import { useTestApp } from '../../test/test-app';
import { InlineMatchQueue, MatchQueue } from './queue';
import { pdfText } from './referral-pdf';

describe('reviewing matches (Week 6)', () => {
  const t = useTestApp();
  const drain = () => (t.app.get(MatchQueue) as InlineMatchQueue).drain();

  async function login(email: string) {
    const res = await t
      .http()
      .post('/api/auth/login')
      .send({ email, password: DEMO_PASSWORD })
      .expect(200);
    return { Authorization: `Bearer ${res.body.accessToken}` };
  }

  /** Alice's P-0001 after one finished run (one result: the diabetes trial). */
  async function matchedPatient() {
    await seedDemoData(t.app.get(DB));
    const auth = await login('alice@trialmatch.dev');
    const list = await t
      .http()
      .get('/api/patients?search=P-0001')
      .set(auth)
      .expect(200);
    const patientId: number = list.body.items[0].id;
    const run = await matchAgain(auth, patientId);
    return { auth, patientId, result: run.results[0] };
  }

  async function matchAgain(
    auth: Record<string, string>,
    patientId: number,
  ): Promise<MatchRun> {
    const started = await t
      .http()
      .post(`/api/patients/${patientId}/match-runs`)
      .set(auth)
      .expect(202);
    await drain();
    return (
      await t
        .http()
        .get(`/api/match-runs/${started.body.id}`)
        .set(auth)
        .expect(200)
    ).body;
  }

  it('starts every match unreviewed', async () => {
    const { result } = await matchedPatient();
    expect(result).toMatchObject({
      decision: 'pending',
      note: null,
      decidedAt: null,
    });
    expect(result.id).toEqual(expect.any(Number));
  });

  it('shortlists with a note, dismisses, and resets to unreviewed', async () => {
    const { auth, patientId, result } = await matchedPatient();

    const shortlisted: MatchResult = (
      await t
        .http()
        .patch(`/api/match-results/${result.id}`)
        .set(auth)
        .send({ decision: 'shortlisted', note: '  Ask about eGFR first.  ' })
        .expect(200)
    ).body;
    expect(shortlisted).toMatchObject({
      id: result.id,
      decision: 'shortlisted',
      note: 'Ask about eGFR first.',
    });
    expect(shortlisted.decidedAt).not.toBeNull();

    const runs = await t
      .http()
      .get(`/api/patients/${patientId}/match-runs`)
      .set(auth)
      .expect(200);
    expect(runs.body[0].results[0]).toMatchObject({
      decision: 'shortlisted',
      note: 'Ask about eGFR first.',
    });

    const reset = await t
      .http()
      .patch(`/api/match-results/${result.id}`)
      .set(auth)
      .send({ decision: 'pending', note: '' })
      .expect(200);
    expect(reset.body).toMatchObject({
      decision: 'pending',
      note: null,
      decidedAt: null,
    });
  });

  it('rejects an unknown decision or an overlong note with field errors', async () => {
    const { auth, result } = await matchedPatient();
    const bad = await t
      .http()
      .patch(`/api/match-results/${result.id}`)
      .set(auth)
      .send({ decision: 'maybe' })
      .expect(400);
    expect(Object.keys(bad.body.fieldErrors)).toEqual(['decision']);
    const long = await t
      .http()
      .patch(`/api/match-results/${result.id}`)
      .set(auth)
      .send({ decision: 'dismissed', note: 'x'.repeat(1001) })
      .expect(400);
    expect(Object.keys(long.body.fieldErrors)).toEqual(['note']);
  });

  it('keeps reviews and referrals private to the owner', async () => {
    const { patientId, result } = await matchedPatient();
    const bob = await login('bob@trialmatch.dev');
    await t
      .http()
      .patch(`/api/match-results/${result.id}`)
      .set(bob)
      .send({ decision: 'dismissed' })
      .expect(404);
    await t
      .http()
      .get(`/api/patients/${patientId}/referral.pdf`)
      .set(bob)
      .expect(404);
  });

  it('carries decisions and notes into the next run for the same patient', async () => {
    const { auth, patientId, result } = await matchedPatient();
    await t
      .http()
      .patch(`/api/match-results/${result.id}`)
      .set(auth)
      .send({ decision: 'dismissed', note: 'Patient declined injections.' })
      .expect(200);

    const next = await matchAgain(auth, patientId);
    expect(next.results[0].id).not.toBe(result.id);
    expect(next.results[0]).toMatchObject({
      trialId: result.trialId,
      decision: 'dismissed',
      note: 'Patient declined injections.',
    });
  });

  it('downloads a referral PDF of the shortlisted trials only', async () => {
    const { auth, patientId, result } = await matchedPatient();
    const empty = await t
      .http()
      .get(`/api/patients/${patientId}/referral.pdf`)
      .set(auth)
      .expect(400);
    expect(empty.body.message).toMatch(/Shortlist at least one trial/);

    await t
      .http()
      .patch(`/api/match-results/${result.id}`)
      .set(auth)
      .send({ decision: 'shortlisted' })
      .expect(200);
    const res = await t
      .http()
      .get(`/api/patients/${patientId}/referral.pdf`)
      .set(auth)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="referral-P-0001.pdf"',
    );
    const pdf = res.body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('Referral summary: P-0001');
    expect(pdf.toString('latin1')).toContain('/Count 1'); // the footer adds no blank page
  });

  it('spells out symbols the built-in PDF fonts cannot draw', () => {
    expect(pdfText('eGFR ≥ 30 – “stable” → yes ≤ 2 ≠ 3 µg 中')).toBe(
      'eGFR >= 30 – “stable” -> yes <= 2 != 3 µg ?',
    );
  });
});
