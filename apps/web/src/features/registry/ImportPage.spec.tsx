import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { makeHit, makePreview, makeTrial } from '../../testing/fixtures';
import { renderApp } from '../../testing/render';
import { server } from '../../testing/server';

describe('ImportPage', () => {
  it('searches, previews and imports a study', async () => {
    const searches: URLSearchParams[] = [];
    const imports: unknown[] = [];
    server.use(
      http.get('*/api/registry/studies', ({ request }) => {
        const params = new URL(request.url).searchParams;
        searches.push(params);
        return HttpResponse.json(
          params.get('pageToken')
            ? {
                items: [
                  makeHit({ nctId: 'NCT90000002', title: 'Second page study' }),
                ],
                total: 2,
                nextPageToken: null,
              }
            : { items: [makeHit()], total: 2, nextPageToken: 'NEXT-1' },
        );
      }),
      http.get('*/api/registry/studies/NCT90000001', () =>
        HttpResponse.json(
          makePreview({
            warnings: [
              'Minimum age is 6 Months on ClinicalTrials.gov; imported as 0.',
            ],
          }),
        ),
      ),
      http.post('*/api/registry/imports', async ({ request }) => {
        imports.push(await request.json());
        return HttpResponse.json(
          makeTrial({
            id: 12,
            title: 'Exercise-induced asthma in adolescents',
            source: 'clinicaltrials_gov',
            sourceLastUpdated: '2026-10-14',
            nctId: 'NCT90000001',
          }),
          { status: 201 },
        );
      }),
      http.get('*/api/trials/12', () =>
        HttpResponse.json(
          makeTrial({
            id: 12,
            title: 'Exercise-induced asthma in adolescents',
            source: 'clinicaltrials_gov',
            sourceLastUpdated: '2026-10-14',
            nctId: 'NCT90000001',
          }),
        ),
      ),
    );
    const { user } = renderApp('/trials/import');

    await user.type(screen.getByLabelText('Condition'), 'asthma');
    await user.selectOptions(screen.getByLabelText('Status'), 'any');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    const results = await screen.findByRole('region', {
      name: 'Search results',
    });
    expect(
      await within(results).findByText('2 studies found · showing 1'),
    ).toBeInTheDocument();
    expect(searches[0].get('condition')).toBe('asthma');
    expect(searches[0].get('status')).toBe('any');

    await user.click(
      within(results).getByRole('button', { name: 'Load more' }),
    );
    expect(
      await within(results).findByText('Second page study'),
    ).toBeInTheDocument();
    expect(searches[1].get('pageToken')).toBe('NEXT-1');

    await user.click(
      within(results).getByRole('button', {
        name: /Exercise-induced asthma in adolescents/,
      }),
    );
    const preview = await screen.findByRole('article', {
      name: 'Exercise-induced asthma in adolescents',
    });
    expect(within(preview).getByText('12–24 years')).toBeInTheDocument();
    expect(
      within(preview).getByText('Check after importing'),
    ).toBeInTheDocument();
    expect(within(preview).getByText('Inclusion criteria')).toBeInTheDocument();
    expect(within(preview).getByText('Age >=12 and <= 24')).toBeInTheDocument();
    expect(within(preview).getByText('E1')).toBeInTheDocument();
    expect(
      within(preview).getByRole('link', {
        name: /NCT90000001 on ClinicalTrials.gov/,
      }),
    ).toHaveAttribute('href', 'https://clinicaltrials.gov/study/NCT90000001');

    await user.click(
      within(preview).getByRole('button', { name: 'Import trial' }),
    );
    expect(imports).toEqual([{ nctId: 'NCT90000001' }]);
    // Lands on the new trial, which says where it came from.
    expect(
      await screen.findByText(
        /Imported from ClinicalTrials.gov \(record last updated Oct 14, 2026\)/,
      ),
    ).toBeInTheDocument();
  });

  it('opens a study directly from its NCT ID', async () => {
    let searched = false;
    server.use(
      http.get('*/api/registry/studies', () => {
        searched = true;
        return HttpResponse.json({ items: [], total: 0, nextPageToken: null });
      }),
      http.get('*/api/registry/studies/NCT90000001', () =>
        HttpResponse.json(makePreview({ importedTrialId: 5 })),
      ),
    );
    const { user } = renderApp('/trials/import');
    await user.type(
      screen.getByLabelText('Other words or NCT ID'),
      ' nct90000001 ',
    );
    await user.click(screen.getByRole('button', { name: 'Search' }));

    const preview = await screen.findByRole('article');
    expect(
      within(preview).getByText('Already in TrialMatch.'),
    ).toBeInTheDocument();
    expect(
      within(preview).getByRole('link', { name: 'Open trial' }),
    ).toHaveAttribute('href', '/trials/5');
    expect(
      within(preview).queryByRole('button', { name: 'Import trial' }),
    ).toBeNull();
    expect(searched).toBe(false);
  });

  it('asks for search words and shows registry errors', async () => {
    server.use(
      http.get('*/api/registry/studies', () =>
        HttpResponse.json(
          {
            statusCode: 502,
            message:
              "ClinicalTrials.gov didn't respond. Try again in a minute.",
          },
          { status: 502 },
        ),
      ),
    );
    const { user } = renderApp('/trials/import');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter a condition or other search words.',
    );
    expect(screen.getByLabelText('Condition')).toHaveAttribute(
      'aria-invalid',
      'true',
    );

    await user.type(screen.getByLabelText('Condition'), 'asthma');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(
      await screen.findByText(
        "ClinicalTrials.gov didn't respond. Try again in a minute.",
      ),
    ).toBeInTheDocument();
  });

  it('opens the existing trial if someone imported the study first', async () => {
    server.use(
      http.get('*/api/registry/studies/NCT90000001', () =>
        HttpResponse.json(makePreview()),
      ),
      http.post('*/api/registry/imports', () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message: 'NCT90000001 is already in TrialMatch.',
            current: { id: 9 },
          },
          { status: 409 },
        ),
      ),
      http.get('*/api/trials/9', () =>
        HttpResponse.json(makeTrial({ id: 9, title: 'Imported by Bob' })),
      ),
    );
    const { user } = renderApp('/trials/import?study=NCT90000001');
    await user.click(
      await screen.findByRole('button', { name: 'Import trial' }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Imported by Bob' }),
    ).toBeInTheDocument();
  });

  it('is reachable from the trials list', async () => {
    server.use(
      http.get('*/api/trials', () =>
        HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 20 }),
      ),
    );
    const { user } = renderApp('/trials');
    await user.click(
      await screen.findByRole('link', {
        name: 'Import from ClinicalTrials.gov',
      }),
    );
    expect(
      await screen.findByRole('heading', {
        name: 'Import from ClinicalTrials.gov',
      }),
    ).toBeInTheDocument();
  });
});
