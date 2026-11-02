import { screen } from '@testing-library/react';
import type { Patient } from '@trialmatch/shared';
import { http, HttpResponse } from 'msw';
import { renderApp } from '../../testing/render';
import { server } from '../../testing/server';

const patient: Patient = {
  id: 5,
  pseudonym: 'P-0005',
  age: 40,
  sex: 'female',
  conditions: ['Asthma'],
  medications: [],
  notes: null,
  version: 1,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
};

describe('PatientPage', () => {
  it('creates a patient with condition tags', async () => {
    let body: unknown;
    server.use(
      http.post('*/api/patients', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          { ...patient, id: 9, pseudonym: 'P-0009' },
          { status: 201 },
        );
      }),
      http.get('*/api/patients/9', () =>
        HttpResponse.json({ ...patient, id: 9, pseudonym: 'P-0009' }),
      ),
    );
    const { user } = renderApp('/patients/new');
    await user.type(await screen.findByLabelText('Pseudonym'), 'P-0009');
    await user.type(screen.getByLabelText('Age'), '61');
    await user.type(
      screen.getByLabelText('Conditions'),
      'Asthma{Enter}COPD{Enter}',
    );
    await user.click(screen.getByRole('button', { name: 'Create patient' }));

    expect(
      await screen.findByRole('heading', { name: 'P-0009' }),
    ).toBeInTheDocument();
    expect(body).toEqual({
      pseudonym: 'P-0009',
      age: 61,
      sex: 'female',
      conditions: ['Asthma', 'COPD'],
      medications: [],
      notes: null,
    });
  });

  it('shows the API field error for a duplicate pseudonym', async () => {
    server.use(
      http.post('*/api/patients', () =>
        HttpResponse.json(
          {
            statusCode: 400,
            message: 'Validation failed',
            fieldErrors: {
              pseudonym: 'You already have a patient with this pseudonym.',
            },
          },
          { status: 400 },
        ),
      ),
    );
    const { user } = renderApp('/patients/new');
    await user.type(await screen.findByLabelText('Pseudonym'), 'P-0005');
    await user.type(screen.getByLabelText('Age'), '40');
    await user.click(screen.getByRole('button', { name: 'Create patient' }));
    expect(
      await screen.findByText(
        'You already have a patient with this pseudonym.',
      ),
    ).toBeInTheDocument();
  });

  it('asks before deleting', async () => {
    let deleted = false;
    server.use(
      http.get('*/api/patients/5', () => HttpResponse.json(patient)),
      http.delete('*/api/patients/5', ({ request }) => {
        deleted = new URL(request.url).searchParams.get('version') === '1';
        return new HttpResponse(null, { status: 204 });
      }),
      http.get('*/api/patients', () =>
        HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 20 }),
      ),
    );
    const { user } = renderApp('/patients/5');
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(deleted).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));
    expect(await screen.findByText('No patients yet.')).toBeInTheDocument();
    expect(deleted).toBe(true);
  });
});
