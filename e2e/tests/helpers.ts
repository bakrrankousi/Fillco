import { expect, Page } from '@playwright/test';

export const PASSWORD = 'Fillco-Demo-2026';
export const USERS = {
  admin: 'admin@fillco.local',
  sales: 'selin.kaya@fillco.local',
  salesKarim: 'karim.mansour@fillco.local',
  purchasing: 'wei.chen@fillco.local',
  finance: 'nadia.farouk@fillco.local',
  viewer: 'viewer@fillco.local',
};

export async function login(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

/** Fills the first order line with a PSF HCS 7D x 64mm specification. */
export async function fillHcsLine(page: Page, qty: string, price: string): Promise<void> {
  const line = page.getByTestId('line-0');
  await line.getByLabel('Line 1 product').selectOption({ label: 'PSF HCS (PSF-HCS)' });
  await line.getByLabel('Denier').fill('7');
  await line.getByLabel('Cut length').fill('64');
  await line.getByLabel('Color').selectOption({ label: 'Optical White' });
  await line.getByLabel('Raw material').selectOption({ label: 'Virgin' });
  await line.getByLabel('Grade').selectOption({ label: 'A Grade' });
  await line.getByLabel('Line 1 quantity').fill(qty);
  await line.getByLabel('Line 1 unit price').fill(price);
}

export async function orderNumber(page: Page): Promise<string> {
  const heading = await page.getByRole('heading', { level: 1 }).innerText();
  const m = /SO-\d{4}-\d{5}/.exec(heading);
  if (!m) throw new Error(`No order number in "${heading}"`);
  return m[0];
}

/** A link in the main sidebar navigation. */
export function nav(page: Page, name: string) {
  return page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true });
}
