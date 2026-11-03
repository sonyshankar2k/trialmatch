import { expect, test } from '@playwright/test';
import { asOtherUser, BOB, signIn, unique } from './support';

test('add a patient, find matching trials, and review each criterion', async ({
  page,
  browser,
}) => {
  const pseudonym = `E2E-${unique()}`.slice(0, 30);
  await signIn(page);
  await page.getByRole('link', { name: 'Patients', exact: true }).click();
  await page.getByRole('link', { name: 'New patient' }).click();
  await page.getByLabel('Pseudonym').fill(pseudonym);
  await page.getByLabel('Age').fill('58');
  await page.getByLabel('Conditions').fill('Type 2 diabetes');
  await page.getByLabel('Conditions').press('Enter');
  await page
    .getByLabel('Clinical notes')
    .fill('HbA1c 8.1%. BMI 34. No history of pancreatitis.');
  await page.getByRole('button', { name: 'Create patient' }).click();
  await expect(page.getByRole('heading', { name: pseudonym })).toBeVisible();

  await page.getByRole('button', { name: 'Find matching trials' }).click();
  // Live progress arrives over the event stream, then the results replace it.
  await expect(page.getByText(/trials? checked/)).toBeVisible({
    timeout: 45_000,
  });

  const card = page
    .getByRole('listitem')
    .filter({ hasText: 'Once-weekly GLP-1 agonist' });
  await expect(card).toBeVisible();
  await expect(
    card.getByRole('row').filter({ hasText: 'History of pancreatitis' }),
  ).toContainText('Does not apply');

  // The run is saved: it's still there after a reload.
  await page.reload();
  await expect(page.getByText(/trials? checked/)).toBeVisible();

  // Another user can't open this patient (it looks like it doesn't exist).
  const bob = await asOtherUser(browser, BOB);
  await bob.page.goto(page.url());
  await expect(
    bob.page.getByRole('heading', { name: 'Patient not found' }),
  ).toBeVisible();
  await bob.close();
});
