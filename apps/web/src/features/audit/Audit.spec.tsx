import { screen, within } from '@testing-library/react';
import type { AuditEvent, Page, Patient } from '@trialmatch/shared';
import { http, HttpResponse } from 'msw';
import { vi } from 'vitest';
import { renderApp } from '../../testing/render';
import { server } from '../../testing/server';
import { makeEvent, sampleHistory } from './audit-fixtures';

const patient: Patient = {
  id: 5,
  pseudonym: 'P-0005',
  age: 41,
  sex: 'female',
  conditions: ['Asthma'],
  medications: [],
  notes: null,
  version: 2,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
};

const page = (items: AuditEvent[]): Page<AuditEvent> => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 50,
});

describe('record history (Week 9)', () => {
  it('loads a patient’s history only when opened', async () => {
    let asked = 0;
    server.use(
      http.get('*/api/patients/5', () => HttpResponse.json(patient)),
      http.get('*/api/patients/5/match-runs', () => HttpResponse.json([])),
      http.get('*/api/patients/5/history', () => {
        asked++;
        return HttpResponse.json(sampleHistory);
      }),
    );
    const { user } = renderApp('/patients/5');
    const toggle = await screen.findByRole('button', { name: 'Show history' });
    expect(asked).toBe(0);

    await user.click(toggle);
    const items = await screen.findAllByRole('listitem');
    expect(asked).toBe(1);
    const edit = items.find((li) =>
      li.textContent?.startsWith('Edited patient'),
    ) as HTMLElement;
    expect(within(edit).getByText('Age: 40 → 41')).toBeInTheDocument();
    expect(
      within(edit).getByText('Notes changed (text not recorded)'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Conditions: Asthma; Hypertension'),
    ).toBeInTheDocument();
    expect(screen.getByText('Opened patient record')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Hide history' }),
    ).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('audit log (Week 9)', () => {
  it('is for administrators only', async () => {
    server.use(
      http.get('*/api/trials', () =>
        HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 20 }),
      ),
    );
    renderApp('/audit');
    expect(
      await screen.findByText(/Only administrators can see the audit log/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Audit log' })).toBeNull();
  });

  it('lists events, filters them through the URL, and exports what is shown', async () => {
    const requests: URLSearchParams[] = [];
    server.use(
      http.get('*/api/audit', ({ request }) => {
        const q = new URL(request.url).searchParams;
        requests.push(q);
        return HttpResponse.json(
          page(
            q.get('action') === 'auth.login_failed'
              ? [
                  makeEvent({
                    id: 9,
                    action: 'auth.login_failed',
                    actor: null,
                    entityType: 'user',
                    label: 'bob@trialmatch.dev',
                    changes: [],
                  }),
                ]
              : [
                  makeEvent(),
                  makeEvent({
                    id: 2,
                    action: 'trial.update',
                    entityType: 'trial',
                    entityId: 7,
                    label: 'GLP-1 agonist in type 2 diabetes',
                    patientId: null,
                    trialId: 7,
                    changes: [
                      { field: 'status', from: 'recruiting', to: 'completed' },
                    ],
                  }),
                ],
          ),
        );
      }),
      http.get('*/api/audit/export.csv', ({ request }) => {
        requests.push(new URL(request.url).searchParams);
        return new HttpResponse('id,at\r\n', {
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition':
              'attachment; filename="audit-log-2026-11-21.csv"',
          },
        });
      }),
    );
    const { user } = renderApp('/audit', { admin: true });

    expect(
      await screen.findByRole('link', { name: 'Audit log' }),
    ).toBeInTheDocument();
    const table = await screen.findByRole('table', {
      name: 'Audit events, newest first',
    });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Edited patient');
    expect(rows[0]).toHaveTextContent('10.0.0.7');
    // Trials link to their page; patients don't (an admin may not own them).
    expect(
      within(rows[1]).getByRole('link', {
        name: 'GLP-1 agonist in type 2 diabetes',
      }),
    ).toHaveAttribute('href', '/trials/7');
    expect(within(rows[0]).queryByRole('link')).toBeNull();

    await user.selectOptions(screen.getByLabelText('Action'), 'Failed sign-in');
    expect(await screen.findByText('bob@trialmatch.dev')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(requests.at(-1)?.get('action')).toBe('auth.login_failed');

    const createObjectURL = vi.fn(() => 'blob:audit');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const saved: string[] = [];
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        saved.push(this.download);
      });
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    await vi.waitFor(() => expect(saved).toEqual(['audit-log-2026-11-21.csv']));
    const exported = requests.at(-1) as URLSearchParams;
    expect(exported.get('action')).toBe('auth.login_failed');
    expect(exported.has('page')).toBe(false);
    click.mockRestore();
  });

  it('says when nothing matches', async () => {
    server.use(http.get('*/api/audit', () => HttpResponse.json(page([]))));
    renderApp('/audit?from=2000-01-01&to=2000-01-02', { admin: true });
    expect(
      await screen.findByText('Nothing recorded matches these filters.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('From')).toHaveValue('2000-01-01');
  });
});
