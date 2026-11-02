import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { makeTrial, pageOf } from '../../testing/fixtures';
import { renderApp } from '../../testing/render';
import { server } from '../../testing/server';

describe('TrialsPage', () => {
  it('lists trials and sends search and filters to the API', async () => {
    const requests: URLSearchParams[] = [];
    server.use(
      http.get('*/api/trials', ({ request }) => {
        const params = new URL(request.url).searchParams;
        requests.push(params);
        const items =
          params.get('search') === 'asthma'
            ? [
                makeTrial({
                  id: 8,
                  title: 'Asthma biologic',
                  status: 'not_yet_recruiting',
                }),
              ]
            : [makeTrial()];
        return HttpResponse.json(pageOf(items));
      }),
    );
    const { user } = renderApp('/trials');

    const link = await screen.findByRole('link', {
      name: 'GLP-1 agonist in type 2 diabetes',
    });
    const row = link.closest('tr') as HTMLElement;
    expect(within(row).getByText('Recruiting')).toBeInTheDocument();
    expect(within(row).getByText('2')).toBeInTheDocument(); // criteria count

    await user.type(screen.getByLabelText('Search trials'), 'asthma');
    expect(
      await screen.findByRole('link', { name: 'Asthma biologic' }),
    ).toBeInTheDocument();
    expect(requests.at(-1)?.get('search')).toBe('asthma');

    await user.selectOptions(screen.getByLabelText('Phase'), 'Phase 2');
    await vi.waitFor(() =>
      expect(requests.at(-1)?.get('phase')).toBe('Phase 2'),
    );
  });

  it('shows an empty state and API errors', async () => {
    server.use(http.get('*/api/trials', () => HttpResponse.json(pageOf([]))));
    const first = renderApp('/trials');
    expect(
      await screen.findByText('No trials match these filters.'),
    ).toBeInTheDocument();
    first.unmount();

    server.use(
      http.get('*/api/trials', () =>
        HttpResponse.json(
          { statusCode: 500, message: 'Database is down' },
          { status: 500 },
        ),
      ),
    );
    renderApp('/trials');
    expect(await screen.findByText('Database is down')).toBeInTheDocument();
  });

  it('signs out when the token has expired', async () => {
    server.use(
      http.get('*/api/trials', () =>
        HttpResponse.json(
          { statusCode: 401, message: 'Expired' },
          { status: 401 },
        ),
      ),
    );
    renderApp('/trials');
    expect(
      await screen.findByRole('heading', { name: 'Sign in to TrialMatch' }),
    ).toBeInTheDocument();
    expect(sessionStorage.getItem('trialmatch.token')).toBeNull();
  });
});
