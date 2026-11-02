import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { makeTrial } from '../../testing/fixtures';
import { renderApp } from '../../testing/render';
import { server } from '../../testing/server';

describe('TrialPage', () => {
  it('creates a trial with criteria in the order entered', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post('*/api/trials', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          makeTrial({ id: 42, title: body['title'] as string }),
          { status: 201 },
        );
      }),
      http.get('*/api/trials/42', () =>
        HttpResponse.json(makeTrial({ id: 42, title: 'New asthma study' })),
      ),
    );
    const { user } = renderApp('/trials/new');

    await user.type(await screen.findByLabelText('Title'), 'New asthma study');
    await user.type(screen.getByLabelText('Condition'), 'Asthma');
    await user.click(screen.getByRole('button', { name: 'Add inclusion' }));
    await user.type(
      screen.getByLabelText('Criterion 1 text'),
      'Age 12 or older',
    );
    await user.click(screen.getByRole('button', { name: 'Add exclusion' }));
    await user.type(
      screen.getByLabelText('Criterion 2 text'),
      'Current smoker',
    );
    await user.click(
      screen.getByRole('button', { name: 'Move criterion 2 up' }),
    );
    await user.click(screen.getByRole('button', { name: 'Create trial' }));

    expect(
      await screen.findByRole('heading', { name: 'New asthma study' }),
    ).toBeInTheDocument();
    expect(body).toMatchObject({
      title: 'New asthma study',
      condition: 'Asthma',
      nctId: null,
      criteria: [
        { type: 'exclusion', text: 'Current smoker' },
        { type: 'inclusion', text: 'Age 12 or older' },
      ],
    });
  });

  it('blocks saving with the shared validation rules', async () => {
    let called = false;
    server.use(
      http.post('*/api/trials', () => {
        called = true;
        return HttpResponse.json({});
      }),
    );
    const { user } = renderApp('/trials/new');
    await user.type(await screen.findByLabelText('NCT ID'), 'ABC123');
    await user.type(screen.getByLabelText('Minimum age'), '70');
    await user.type(screen.getByLabelText('Maximum age'), '18');
    await user.click(screen.getByRole('button', { name: 'Add inclusion' }));
    await user.click(screen.getByRole('button', { name: 'Create trial' }));

    expect(
      await screen.findByText('Format: NCT followed by 8 digits'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Must be at least the minimum age'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Required').length).toBeGreaterThanOrEqual(3); // title, condition, criterion
    expect(called).toBe(false);
  });

  it('saves only the changed fields with the version it read', async () => {
    let body: unknown;
    server.use(
      http.get('*/api/trials/7', () => HttpResponse.json(makeTrial())),
      http.patch('*/api/trials/7', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          makeTrial({ status: 'completed', version: 4 }),
        );
      }),
    );
    const { user } = renderApp('/trials/7');
    await user.selectOptions(
      await screen.findByLabelText('Status'),
      'completed',
    );
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(body).toEqual({ status: 'completed', version: 3 });
    expect(screen.getByText(/Version 4/)).toBeInTheDocument();
  });

  it('on 409 lets the user load their version or save over it', async () => {
    const theirs = makeTrial({ title: 'Renamed by Bob', version: 5 });
    const versions: number[] = [];
    server.use(
      http.get('*/api/trials/7', () => HttpResponse.json(makeTrial())),
      http.patch('*/api/trials/7', async ({ request }) => {
        const b = (await request.json()) as {
          version: number;
          sponsor?: string;
        };
        versions.push(b.version);
        if (b.version === 3) {
          return HttpResponse.json(
            { statusCode: 409, message: 'Conflict', current: theirs },
            { status: 409 },
          );
        }
        return HttpResponse.json({
          ...theirs,
          sponsor: b.sponsor ?? null,
          version: 6,
        });
      }),
    );
    const { user } = renderApp('/trials/7');
    const sponsor = await screen.findByLabelText('Sponsor');
    await user.clear(sponsor);
    await user.type(sponsor, 'Mine Inc');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(
      await screen.findByText(
        'Someone else saved this record after you opened it.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save mine anyway' }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(versions).toEqual([3, 5]); // retried against their version
  });

  it('shows not found for a missing trial', async () => {
    server.use(
      http.get('*/api/trials/999', () =>
        HttpResponse.json(
          { statusCode: 404, message: 'Trial not found.' },
          { status: 404 },
        ),
      ),
    );
    renderApp('/trials/999');
    expect(
      await screen.findByRole('heading', { name: 'Trial not found' }),
    ).toBeInTheDocument();
  });
});
