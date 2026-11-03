import { expect, test } from '@playwright/test';
import { DEMO_PASSWORD, signIn } from './support';

test('a signed-out visitor is sent to sign in, then back to the page they wanted', async ({
  page,
}) => {
  await page.goto('/patients');
  await expect(
    page.getByRole('heading', { name: 'Sign in to TrialMatch' }),
  ).toBeVisible();
  await page.getByLabel('Email').fill('alice@trialmatch.dev');
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Patients' })).toBeVisible();
});

test('wrong password shows one message for any failure', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('alice@trialmatch.dev');
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Incorrect email or password.',
  );
});

test('signing out returns to the sign-in page and protects the app again', async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(
    page.getByRole('heading', { name: 'Sign in to TrialMatch' }),
  ).toBeVisible();
  await page.goto('/trials');
  await expect(
    page.getByRole('heading', { name: 'Sign in to TrialMatch' }),
  ).toBeVisible();
});
