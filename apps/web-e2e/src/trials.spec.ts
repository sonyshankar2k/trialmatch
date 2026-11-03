import { expect, test } from '@playwright/test';
import { asOtherUser, BOB, signIn, unique } from './support';

test('create a trial with ordered criteria, edit it, then delete it', async ({
  page,
}) => {
  const title = `E2E asthma study ${unique()}`;
  await signIn(page);
  await page.getByRole('link', { name: 'New trial' }).click();

  // The shared validation rules run in the browser first.
  await page.getByRole('button', { name: 'Create trial' }).click();
  await expect(page.getByText('Required').first()).toBeVisible();

  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Condition').fill('Asthma');
  await page.getByLabel('Phase').selectOption('Phase 2');
  await page.getByRole('button', { name: 'Add inclusion' }).click();
  await page.getByLabel('Criterion 1 text').fill('Age 12 or older');
  await page.getByRole('button', { name: 'Add exclusion' }).click();
  await page.getByLabel('Criterion 2 text').fill('Current smoker');
  await page.getByRole('button', { name: 'Add inclusion' }).click();
  await page
    .getByLabel('Criterion 3 text')
    .fill('Two exacerbations in the past year');
  await page.getByRole('button', { name: 'Move criterion 3 up' }).click();
  await page.getByRole('button', { name: 'Create trial' }).click();

  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('Version 1')).toBeVisible();
  await expect(page.getByLabel('Criterion 2 text')).toHaveValue(
    'Two exacerbations in the past year',
  );

  await page.getByLabel('Status').selectOption('recruiting');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Version 2')).toBeVisible();

  // Search finds it, and the filters live in the URL.
  await page.getByRole('link', { name: '← Trials' }).click();
  await page.getByLabel('Search trials').fill(title);
  await page.getByLabel('Status').selectOption('recruiting');
  await expect(page).toHaveURL(/status=recruiting/);
  await page.reload();
  await expect(page.getByRole('link', { name: title })).toBeVisible();

  await page.getByRole('link', { name: title }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Yes, delete' }).click();
  await expect(
    page.getByRole('heading', { name: 'Clinical trials' }),
  ).toBeVisible();
  await page.getByLabel('Search trials').fill(title);
  await expect(page.getByText('No trials match these filters.')).toBeVisible();
});

test('two people edit the same trial: the second save gets the conflict banner', async ({
  page,
  browser,
}) => {
  const title = `E2E conflict ${unique()}`;
  await signIn(page);
  await page.goto('/trials/new');
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Condition').fill('Hypertension');
  await page.getByRole('button', { name: 'Create trial' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  const bob = await asOtherUser(browser, BOB);
  await bob.page.goto(page.url());
  await expect(bob.page.getByLabel('Sponsor')).toBeVisible();

  await page.getByLabel('Sponsor').fill('Alice Pharma');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Version 2')).toBeVisible();

  await bob.page.getByLabel('Sponsor').fill('Bob Pharma');
  await bob.page.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    bob.page.getByText('Someone else saved this record after you opened it.'),
  ).toBeVisible();
  await bob.page.getByRole('button', { name: 'Load their version' }).click();
  await expect(bob.page.getByLabel('Sponsor')).toHaveValue('Alice Pharma');
  await bob.close();
});
