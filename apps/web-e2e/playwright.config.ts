import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests: a real browser against the whole running stack
 * (React app, API with its matching worker, PostgreSQL, Redis).
 *
 *   docker compose up -d --build --wait   # start the stack (http://localhost:8080)
 *   npx playwright install chromium       # once
 *   npx nx e2e web-e2e                    # run;  E2E_BASE_URL=... to point elsewhere
 */
export default defineConfig({
  testDir: './src',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false, // the tests share one database
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI']
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : 'list',
  outputDir: 'test-results',
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
