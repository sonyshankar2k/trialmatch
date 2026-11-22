import { screen, within } from '@testing-library/react';
import type { TrialUpdate } from '@trialmatch/shared';
import { http, HttpResponse } from 'msw';
import { makeTrial } from '../../testing/fixtures';
import { renderApp } from '../../testing/render';
import { server } from '../../testing/server';

const imported = makeTrial({
  source: 'clinicaltrials_gov',
  sourceLastUpdated: '2026-01-10',
  sourceCheckedAt: '2026-11-20T06:00:00.000Z',
  pendingUpdateId: 5,
});

const update: TrialUpdate = {
  id: 5,
  trialId: 7,
  nctId: 'NCT99000001',
  registryLastUpdated: '2026-11-19',
  fields: [{ field: 'status', current: 'recruiting', registry: 'completed' }],
  criteria: {
    added: [{ type: 'exclusion', text: 'Pregnancy' }],
    removed: [{ type: 'inclusion', text: 'HbA1c 7–10.5%' }],
  },
  warnings: [],
  status: 'pending',
  detectedAt: '2026-11-20T06:00:00.000Z',
  resolvedAt: null,
  resolvedBy: null,
};

/** The trial page of an imported trial, with its match runs and pending update. */
function serve(pending: TrialUpdate | null) {
  server.use(
    http.get('*/api/trials/7', () => HttpResponse.json(imported)),
    http.get('*/api/trials/7/match-runs', () => HttpResponse.json([])),
    http.get('*/api/registry/trials/7/update', () =>
      HttpResponse.json({ update: pending }),
    ),
  );
}

describe('registry updates on the trial page (Week 8)', () => {
  it('shows what changed and applies it with the version read', async () => {
    serve(update);
    let sent: unknown;
    server.use(
      http.post('*/api/registry/updates/5/apply', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(
          makeTrial({
            ...imported,
            status: 'completed',
            pendingUpdateId: null,
            sourceLastUpdated: '2026-11-19',
            version: imported.version + 1,
          }),
        );
      }),
    );
    const { user } = renderApp('/trials/7');

    const box = (
      await screen.findByRole('heading', { name: /ClinicalTrials.gov updates/ })
    ).closest('section') as HTMLElement;
    const row = await within(box).findByRole('row', { name: /Status/ });
    expect(
      within(row)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['Recruiting', 'Completed']);
    expect(
      within(box)
        .getByText(/Added exclusion:/)
        .closest('li'),
    ).toHaveTextContent('Added exclusion: Pregnancy');
    expect(within(box).getByText(/Removed inclusion:/)).toBeInTheDocument();

    await user.click(within(box).getByRole('button', { name: 'Apply update' }));
    expect(
      await screen.findByText(/Update applied. Screen your patients again/),
    ).toBeInTheDocument();
    expect(sent).toEqual({ version: imported.version });
    expect(screen.queryByRole('button', { name: 'Apply update' })).toBeNull();
    expect(screen.getByLabelText('Status')).toHaveValue('completed');
  });

  it('waits for unsaved edits before applying, and can keep the current version', async () => {
    serve(update);
    let dismissed = false;
    server.use(
      http.post('*/api/registry/updates/5/dismiss', () => {
        dismissed = true;
        return HttpResponse.json({ ...imported, pendingUpdateId: null });
      }),
    );
    const { user } = renderApp('/trials/7');
    const apply = await screen.findByRole('button', { name: 'Apply update' });
    expect(apply).toBeEnabled();

    await user.type(screen.getByLabelText('Sponsor'), ' Ltd');
    expect(apply).toBeDisabled();
    expect(apply).toHaveAccessibleDescription(
      'Save or discard your edits before applying.',
    );

    await user.click(
      screen.getByRole('button', { name: 'Keep current version' }),
    );
    expect(
      await screen.findByText(/Kept the current version/),
    ).toBeInTheDocument();
    expect(dismissed).toBe(true);
  });

  it('checks now and says when the trial is in step', async () => {
    serve(null);
    server.use(
      http.post('*/api/registry/trials/7/check', () =>
        HttpResponse.json({ update: null }),
      ),
    );
    const { user } = renderApp('/trials/7');
    expect(await screen.findByText(/Last checked/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check now' }));
    expect(
      await screen.findByText(/In step with ClinicalTrials.gov/),
    ).toBeInTheDocument();
  });

  it('does not show for trials typed in by hand', async () => {
    server.use(
      http.get('*/api/trials/7', () => HttpResponse.json(makeTrial())),
      http.get('*/api/trials/7/match-runs', () => HttpResponse.json([])),
    );
    renderApp('/trials/7');
    expect(await screen.findByLabelText('Status')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /ClinicalTrials.gov updates/ }),
    ).toBeNull();
  });
});
