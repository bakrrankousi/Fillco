import { expect, test } from '@playwright/test';
import { fillHcsLine, login, orderNumber, USERS } from './helpers';
import { nav } from './helpers';

test('an order over the credit limit needs finance to override with a reason', async ({ page }) => {
  // Amman Quilts has most of its USD 80,000 limit in use.
  await login(page, USERS.salesKarim);
  await page.goto('/sales-orders/new');
  await page.getByLabel('Customer').first().selectOption({ label: 'Amman Quilts & Pillows Co. (JO)' });
  await fillHcsLine(page, '30', '1150');
  await page.getByRole('button', { name: 'Save draft order' }).click();
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();
  const number = await orderNumber(page);
  const url = page.url();

  await page.getByRole('button', { name: 'Confirm order' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Limit exceeded', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/Ask finance/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Override/ })).toHaveCount(0);

  await login(page, USERS.finance);
  await page.goto(url);
  await page.getByRole('button', { name: 'Confirm order' }).click();
  const financeDialog = page.getByRole('dialog');
  await expect(financeDialog.getByText('Limit exceeded', { exact: true })).toBeVisible();
  await financeDialog
    .getByLabel('Override reason')
    .fill('Owner guarantee received on 23 Sep; limit review next week');
  await financeDialog.getByRole('button', { name: 'Override and confirm' }).click();
  await expect(page.getByText('Purchase Required').first()).toBeVisible();
  await expect(page.getByText(/Overridden by Nadia Farouk/)).toBeVisible();
  await expect(page.getByText(`${number}`).first()).toBeVisible();
});

test('viewers can read but not create, and never see purchase prices', async ({ page }) => {
  await login(page, USERS.viewer);
  await nav(page, 'Sales Orders').click();
  await expect(page.getByRole('heading', { name: 'Sales orders' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New order' })).toHaveCount(0);
  await nav(page, 'Purchases').click();
  await expect(page.getByRole('button', { name: 'New purchase order' })).toHaveCount(0);
  const firstValue = page.locator('tbody tr').first().locator('td').nth(3);
  await expect(firstValue).toHaveText('—');
  await expect(nav(page, 'Settings')).toBeVisible();
  await expect(nav(page, 'Audit log')).toHaveCount(0);
});

test('supplier bank details need a second person to approve', async ({ page }) => {
  const bank = `E2E Bank ${Date.now()}`;
  await login(page, USERS.purchasing);
  await nav(page, 'Suppliers').click();
  await page.getByRole('link', { name: 'Marmara Polyester Tekstil Ltd. Şti.' }).click();
  await page.getByRole('tab', { name: /Bank accounts/ }).click();
  await page.getByRole('button', { name: 'Add bank account' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Bank name').fill(bank);
  await dialog.getByLabel('Account holder').fill('Marmara Polyester Tekstil');
  await dialog.getByLabel('IBAN', { exact: true }).fill('TR12 0001 0000 0000 1234 5678 90');
  await dialog.getByRole('button', { name: 'Submit for approval' }).click();
  const row = page.getByRole('row', { name: new RegExp(bank) });
  await expect(row.getByText('Pending approval')).toBeVisible();
  // Purchasing entered it and cannot approve it.
  await expect(row.getByRole('button', { name: 'Approve' })).toHaveCount(0);

  await login(page, USERS.finance);
  await nav(page, 'Suppliers').click();
  await page.getByRole('link', { name: 'Marmara Polyester Tekstil Ltd. Şti.' }).click();
  await page.getByRole('tab', { name: /Bank accounts/ }).click();
  const financeRow = page.getByRole('row', { name: new RegExp(bank) });
  await financeRow.getByRole('button', { name: 'Approve' }).click();
  await expect(financeRow.getByText('Approved', { exact: true })).toBeVisible();
  await expect(financeRow.getByText(/Nadia Farouk/)).toBeVisible();
});
