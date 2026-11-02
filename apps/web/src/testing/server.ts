import { setupServer } from 'msw/node';

/** Mock API for component tests (Mock Service Worker). Each test adds the handlers it needs. */
export const server = setupServer();
