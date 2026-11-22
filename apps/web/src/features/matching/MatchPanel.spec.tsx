import { screen, within } from '@testing-library/react';
import type { MatchRun, Patient } from '@trialmatch/shared';
import { http, HttpResponse } from 'msw';
import { vi } from 'vitest';
import { makeTrial } from '../../testing/fixtures';
import { renderApp } from '../../testing/render';
import { server } from '../../testing/server';

const patient: Patient = {
  id: 1,
  pseudonym: 'P-0001',
  age: 54,
  sex: 'female',
  conditions: ['Type 2 diabetes'],
  medications: [],
  notes: 'No history of pancreatitis.',
  version: 1,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
};

const run = (overrides: Partial<MatchRun>): MatchRun => ({
  id: 3,
  kind: 'patient',
  patientId: 1,
  trialId: null,
  trialVersion: null,
  status: 'queued',
  progress: 0,
  stage: 'Waiting for a worker',
  engine: null,
  error: null,
  results: [],
  createdAt: '2026-11-01T10:00:00.000Z',
  finishedAt: null,
  ...overrides,
});

const finished = run({
  status: 'succeeded',
  progress: 100,
  engine: 'claude',
  stage: '1 trial checked: 0 likely eligible, 1 need review',
  finishedAt: '2026-11-01T10:00:05.000Z',
  results: [
    {
      id: 1,
      patientId: 1,
      pseudonym: 'P-0001',
      trialId: 7,
      nctId: 'NCT99000001',
      title: 'GLP-1 agonist in type 2 diabetes',
      condition: 'Type 2 diabetes',
      eligibility: 'possibly_eligible',
      score: 50,
      summary: 'No criterion rules the patient out. Check E1 by hand.',
      decision: 'pending',
      note: null,
      decidedAt: null,
      assessments: [
        {
          criterionId: 1,
          code: 'I1',
          type: 'inclusion',
          text: 'Type 2 diabetes',
          verdict: 'met',
          reason: 'Listed condition',
          evidence: 'Type 2 diabetes',
        },
        {
          criterionId: 2,
          code: 'E1',
          type: 'exclusion',
          text: 'eGFR below 30',
          verdict: 'unknown',
          reason: 'Not in the profile',
          evidence: null,
        },
        {
          criterionId: 3,
          code: 'E2',
          type: 'exclusion',
          text: 'Pancreatitis',
          verdict: 'not_met',
          reason: 'Notes deny it',
          evidence: 'No history of pancreatitis',
        },
      ],
    },
  ],
});

/** A text/event-stream body: one `data:` message per event, then the stream ends. */
function sse(...events: unknown[]) {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  return new HttpResponse(body, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('MatchPanel', () => {
  it('starts a run, follows its live progress, and shows the verdict per criterion', async () => {
    let authHeader: string | null = null;
    server.use(
      http.get('*/api/patients/1', () => HttpResponse.json(patient)),
      http.get('*/api/patients/1/match-runs', () => HttpResponse.json([])),
      http.post('*/api/patients/1/match-runs', () =>
        HttpResponse.json(run({}), { status: 202 }),
      ),
      http.get('*/api/match-runs/3/events', ({ request }) => {
        authHeader = request.headers.get('Authorization');
        return sse(
          {
            type: 'run',
            run: run({
              status: 'running',
              progress: 40,
              stage: 'Checking “GLP-1…” (1 of 1)',
            }),
          },
          { type: 'ping' },
          { type: 'run', run: finished },
        );
      }),
    );
    const { user } = renderApp('/patients/1');

    await user.click(
      await screen.findByRole('button', { name: 'Find matching trials' }),
    );
    expect(
      await screen.findByText(
        '1 trial checked: 0 likely eligible, 1 need review',
      ),
    ).toBeInTheDocument();
    expect(authHeader).toBe('Bearer test-token'); // the stream is authenticated

    const card = screen
      .getByRole('link', { name: 'GLP-1 agonist in type 2 diabetes' })
      .closest('li') as HTMLElement;
    expect(within(card).getByText('Needs review')).toBeInTheDocument();
    const rows = within(card).getAllByRole('row').slice(1);
    expect(
      rows.map((r) => within(r).getAllByRole('cell')[1].textContent),
    ).toEqual(['Met', 'Unknown', 'Does not apply']);
    expect(screen.getByText(/Assessed by Claude/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Match again' })).toBeEnabled();
  });

  it('shows the latest finished run on load, and a failed run’s message', async () => {
    server.use(
      http.get('*/api/patients/1', () => HttpResponse.json(patient)),
      http.get('*/api/patients/1/match-runs', () =>
        HttpResponse.json([
          run({
            status: 'failed',
            error:
              'The AI service rejected the API key. Check ANTHROPIC_API_KEY.',
          }),
        ]),
      ),
    );
    renderApp('/patients/1');
    expect(
      await screen.findByText(
        'The AI service rejected the API key. Check ANTHROPIC_API_KEY.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Match again' })).toBeEnabled();
  });
});

describe('MatchPanel review (Week 6)', () => {
  it('shortlists a match, adds a note, and downloads the referral summary', async () => {
    const reviews: unknown[] = [];
    server.use(
      http.get('*/api/patients/1', () => HttpResponse.json(patient)),
      http.get('*/api/patients/1/match-runs', () =>
        HttpResponse.json([finished]),
      ),
      http.patch('*/api/match-results/1', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        reviews.push(body);
        return HttpResponse.json({
          ...finished.results[0],
          ...body,
          note: body['note'] || null,
          decidedAt: '2026-11-21T09:00:00.000Z',
        });
      }),
      http.get(
        '*/api/patients/1/referral.pdf',
        () =>
          new HttpResponse('%PDF-1.3', {
            headers: {
              'Content-Type': 'application/pdf',
              'Content-Disposition':
                'attachment; filename="referral-P-0001.pdf"',
            },
          }),
      ),
    );
    const createObjectURL = vi.fn(() => 'blob:referral');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const saved: string[] = [];
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        saved.push(this.download);
      });
    const { user } = renderApp('/patients/1');

    const download = await screen.findByRole('button', {
      name: 'Download referral summary (PDF)',
    });
    expect(download).toBeDisabled(); // nothing shortlisted yet

    const shortlist = screen.getByRole('button', { name: 'Shortlist' });
    await user.click(shortlist);
    expect(
      await screen.findByText('1 trial shortlisted for referral.'),
    ).toBeInTheDocument();
    expect(shortlist).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Add note' }));
    await user.type(
      screen.getByLabelText('Note for the study team'),
      'Check eGFR first.',
    );
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    expect(await screen.findByText('Check eGFR first.')).toBeInTheDocument();
    expect(reviews).toEqual([
      { decision: 'shortlisted', note: null },
      { decision: 'shortlisted', note: 'Check eGFR first.' },
    ]);

    await user.click(download);
    await vi.waitFor(() => expect(saved).toEqual(['referral-P-0001.pdf']));
    expect(createObjectURL).toHaveBeenCalledOnce();
    click.mockRestore();
  });
});

describe('MatchPanel on a trial (Week 7)', () => {
  const screening = run({
    kind: 'trial',
    patientId: null,
    trialId: 7,
    trialVersion: makeTrial().version,
    status: 'succeeded',
    progress: 100,
    engine: 'rules',
    stage: '1 patient checked: 0 likely eligible, 1 need review',
    finishedAt: '2026-11-01T10:00:05.000Z',
    results: finished.results,
  });

  it('screens your patients for the trial and shortlists one', async () => {
    let started = false;
    server.use(
      http.get('*/api/trials/7', () => HttpResponse.json(makeTrial({ id: 7 }))),
      http.get('*/api/trials/7/match-runs', () => HttpResponse.json([])),
      http.post('*/api/trials/7/match-runs', () => {
        started = true;
        return HttpResponse.json(
          { ...screening, status: 'queued', results: [] },
          { status: 202 },
        );
      }),
      http.get('*/api/match-runs/3/events', () =>
        sse({ type: 'run', run: screening }),
      ),
      http.patch('*/api/match-results/1', async ({ request }) =>
        HttpResponse.json({
          ...screening.results[0],
          ...((await request.json()) as object),
          decidedAt: '2026-11-21T09:00:00.000Z',
        }),
      ),
    );
    const { user } = renderApp('/trials/7');

    await user.click(
      await screen.findByRole('button', { name: 'Find eligible patients' }),
    );
    expect(started).toBe(true);
    expect(
      await screen.findByText(
        '1 patient checked: 0 likely eligible, 1 need review',
      ),
    ).toBeInTheDocument();

    // The card is headed by the patient, linking to their page.
    const link = screen.getByRole('link', { name: 'P-0001' });
    expect(link).toHaveAttribute('href', '/patients/1');
    const card = link.closest('li') as HTMLElement;
    expect(within(card).getByText('Needs review')).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: 'Shortlist' }));
    expect(
      await screen.findByText(/^1 patient shortlisted\./),
    ).toBeInTheDocument();
    // Referral summaries are per patient, so there is no download here.
    expect(
      screen.queryByRole('button', { name: /referral summary/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Screen again' })).toBeEnabled();
  });

  // Week 8: staleness follows the trial version the worker screened, not when the run was queued.
  it.each([
    ['the version screened is current', makeTrial().version, false],
    ['the trial changed after it was screened', makeTrial().version - 1, true],
  ])('flags old results only when %s', async (_, trialVersion, stale) => {
    server.use(
      http.get('*/api/trials/7', () => HttpResponse.json(makeTrial({ id: 7 }))),
      http.get('*/api/trials/7/match-runs', () =>
        // Queued before the trial's last save, but screened by the worker later.
        HttpResponse.json([
          { ...screening, trialVersion, createdAt: '2026-10-01T09:00:00.000Z' },
        ]),
      ),
    );
    renderApp('/trials/7');
    expect(
      await screen.findByText(
        '1 patient checked: 0 likely eligible, 1 need review',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/This trial changed after this screening/) !== null,
    ).toBe(stale);
  });
});
