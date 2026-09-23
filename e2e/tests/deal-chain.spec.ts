import { expect, test } from '@playwright/test';
import { fillHcsLine, login, orderNumber, USERS } from './helpers';
import { nav } from './helpers';

test.describe.configure({ mode: 'serial' });

let soNumber = '';
let soUrl = '';

test('sales creates and confirms a customer order within the credit limit', async ({ page }) => {
  await login(page, USERS.sales);
  await nav(page, 'Sales Orders').click();
  await page.getByRole('button', { name: 'New order' }).click();
  await page.getByLabel('Customer').first().selectOption({ label: 'Delta Home Textiles S.A.E. (EG)' });
  await page.getByLabel('Customer PO reference').fill('E2E-PO-1');
  await fillHcsLine(page, '20', '1150');
  await expect(page.getByText('USD 23,000.00').first()).toBeVisible();
  await page.getByRole('button', { name: 'Save draft order' }).click();

  await expect(page.getByText('Draft', { exact: true })).toBeVisible();
  soNumber = await orderNumber(page);
  soUrl = page.url();
  await expect(page.getByText('PSF HCS 7D x 64mm Optical White Virgin A Grade').first()).toBeVisible();

  await page.getByRole('button', { name: 'Confirm order' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Within limit')).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm order' }).click();
  await expect(page.getByText('Purchase Required').first()).toBeVisible();
  // 30% advance / 70% against BL schedule was snapshotted.
  await expect(page.getByText('30% at order confirmation').first()).toBeVisible();
  await expect(page.getByText(/waiting for BL date/).first()).toBeVisible();
});

test('purchasing buys it back-to-back and the supplier confirms', async ({ page }) => {
  await login(page, USERS.purchasing);
  await page.goto(`/purchases/awaiting?q=${soNumber}`);
  await page.getByRole('checkbox', { name: `Select ${soNumber} line 1` }).check();
  await page.getByRole('button', { name: /Create PO for 1 selected/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('combobox', { name: /^Supplier/ })
    .selectOption({ label: 'Anatolia Elyaf Sanayi A.Ş. (TR) · 21d lead time' });
  await dialog.getByLabel(`Price for ${soNumber} line 1`).fill('1010');
  await expect(dialog.getByText('USD 20,200.00')).toBeVisible();
  await dialog.getByRole('button', { name: 'Create draft PO' }).click();

  await expect(page.getByRole('heading', { level: 1 })).toContainText('PO-2026-');
  await expect(page.getByRole('link', { name: soNumber }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Supplier confirmed' }).click();
  const confirm = page.getByRole('dialog');
  await confirm.getByLabel('Supplier reference (PI no.)').fill('E2E-PI-77');
  await confirm.getByRole('button', { name: 'Supplier confirmed' }).click();
  await expect(page.getByText('Confirmed', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Supplier payment schedule' })).toBeVisible();
});

test('the customer order now shows the full chain and costs stay hidden from sales', async ({ page }) => {
  await login(page, USERS.sales);
  await page.goto(soUrl);
  await expect(page.getByText('Fully Purchased').first()).toBeVisible();
  await expect(page.getByText('Anatolia Elyaf Sanayi A.Ş.').first()).toBeVisible();
  await expect(page.getByText('Visible to finance')).toBeVisible();
  await expect(page.getByText(/allocated to PO-2026-/)).toBeVisible();

  await login(page, USERS.admin);
  await page.goto(soUrl);
  // 20 MT × (1150 − 1010) = 2,800 USD estimated gross profit.
  await expect(page.getByText('USD 2,800.00').first()).toBeVisible();
});

test('global search finds the order by number', async ({ page }) => {
  await login(page, USERS.sales);
  await page.getByLabel('Global search').fill(soNumber);
  await page.getByRole('button', { name: new RegExp(soNumber) }).click();
  await expect(page).toHaveURL(soUrl);
});
