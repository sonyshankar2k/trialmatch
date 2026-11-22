import { render, type RenderResult } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App, createQueryClient } from '../app/app';
import { tokenStore } from '../lib/api';
import { aliceAuth } from './fixtures';

/** Renders the whole app at `path`, optionally signed in as Alice (Week 9: as an admin too). */
export function renderApp(
  path: string,
  { signedIn = true, admin = false } = {},
): RenderResult & { user: UserEvent } {
  if (signedIn) {
    tokenStore.set(aliceAuth.accessToken);
    sessionStorage.setItem(
      'trialmatch.user',
      JSON.stringify({
        ...aliceAuth.user,
        role: admin ? 'admin' : 'coordinator',
      }),
    );
  }
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  const user = userEvent.setup();
  const result = render(
    <MemoryRouter initialEntries={[path]}>
      <App queryClient={queryClient} />
    </MemoryRouter>,
  );
  return { user, ...result };
}
