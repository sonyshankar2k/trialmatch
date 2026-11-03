import AxeBuilder from '@axe-core/playwright';
import { expect, type Browser, type Page } from '@playwright/test';

export const DEMO_PASSWORD = 'trialmatch-demo';
export const ALICE = 'alice@trialmatch.dev';
export const BOB = 'bob@trialmatch.dev';

/** A suffix that keeps data from separate runs apart (the database isn't reset between runs). */
export const unique = () =>
  `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;

export async function signIn(page: Page, email = ALICE) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    page.getByRole('heading', { name: 'Clinical trials' }),
  ).toBeVisible();
}

/** A separate browser context: its own session storage, i.e. another person. */
export async function asOtherUser(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email);
  return { page, close: () => context.close() };
}

/** WCAG 2.1 AA scan of the current page; fails on serious or critical problems. */
export async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.nodes.length}): ${v.help}`);
  expect(serious).toEqual([]);
}
