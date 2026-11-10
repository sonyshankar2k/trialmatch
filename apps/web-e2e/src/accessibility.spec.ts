import { expect, test } from '@playwright/test';
import { expectAccessible, signIn } from './support';

test.describe('accessibility (WCAG 2.1 AA, axe)', () => {
  test('sign-in page', async ({ page }) => {
    await page.goto('/login');
    await expect(
      page.getByRole('heading', { name: 'Sign in to TrialMatch' }),
    ).toBeVisible();
    await expectAccessible(page);
  });

  test('trials list and a trial', async ({ page }) => {
    await signIn(page);
    await expectAccessible(page);
    await page.getByRole('link', { name: /eosinophilic asthma/ }).click();
    await expect(page.getByLabel('Criterion 1 text')).toBeVisible();
    await expectAccessible(page);
  });

  test('ClinicalTrials.gov import page', async ({ page }) => {
    await signIn(page);
    await page
      .getByRole('link', { name: 'Import from ClinicalTrials.gov' })
      .click();
    // Searching with nothing typed explains itself without calling the registry.
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('alert')).toHaveText(
      'Enter a condition or other search words.',
    );
    await expectAccessible(page);
  });

  test('patients and a patient with match results', async ({ page }) => {
    await signIn(page);
    await page.getByRole('link', { name: 'Patients', exact: true }).click();
    await expect(page.getByRole('link', { name: 'P-0002' })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('link', { name: 'P-0002' }).click();
    await page
      .getByRole('button', { name: /Find matching trials|Match again/ })
      .click();
    await expect(page.getByText(/trials? checked/)).toBeVisible({
      timeout: 45_000,
    });
    await expectAccessible(page);
  });

  test('the whole sign-in can be done with the keyboard', async ({ page }) => {
    await page.goto('/login');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Email')).toBeFocused();
    await page.keyboard.type('alice@trialmatch.dev');
    await page.keyboard.press('Tab');
    await page.keyboard.type('trialmatch-demo');
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('heading', { name: 'Clinical trials' }),
    ).toBeVisible();
  });
});
