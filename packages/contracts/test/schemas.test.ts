import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  bankAccountSchema,
  createCustomerSchema,
  DEFAULT_ROLES,
  decimalString,
  exchangeRateSchema,
  salesOrderSchema,
} from '../src';

describe('decimal strings', () => {
  const d = decimalString({ maxDecimals: 2 });
  it('accepts numbers and strings, normalizing to strings', () => {
    expect(d.parse(12.5)).toBe('12.5');
    expect(d.parse(' 100.25 ')).toBe('100.25');
  });
  it('rejects too many decimals, negatives and junk', () => {
    expect(d.safeParse('1.234').success).toBe(false);
    expect(d.safeParse('-1').success).toBe(false);
    expect(d.safeParse('1e5').success).toBe(false);
  });
});

describe('request schemas', () => {
  it('normalizes customer input', () => {
    const c = createCustomerSchema.parse({
      companyName: ' Nile Home Textiles ',
      countryCode: 'eg',
      defaultCurrency: 'usd',
      email: '',
      creditLimit: 150000,
    });
    expect(c.companyName).toBe('Nile Home Textiles');
    expect(c.countryCode).toBe('EG');
    expect(c.defaultCurrency).toBe('USD');
    expect(c.email).toBeNull();
    expect(c.creditLimit).toBe('150000');
    expect(c.contacts).toEqual([]);
  });
  it('requires order lines with positive quantity', () => {
    const base = {
      customerId: '0190d7a0-0000-7000-8000-000000000001',
      orderDate: '2026-09-23',
      currency: 'USD',
    };
    expect(salesOrderSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
    const bad = salesOrderSchema.safeParse({
      ...base,
      lines: [{ productId: base.customerId, qty: '0', uom: 'MT', unitPrice: '1000' }],
    });
    expect(bad.success).toBe(false);
  });
  it('rejects same-currency exchange rates', () => {
    expect(
      exchangeRateSchema.safeParse({
        rateDate: '2026-09-01',
        fromCurrency: 'USD',
        toCurrency: 'usd',
        rate: '1',
      }).success,
    ).toBe(false);
  });
  it('validates IBAN and requires an account identifier', () => {
    const ok = bankAccountSchema.parse({
      bankName: 'Ziraat',
      accountName: 'Anatolia Fiber',
      iban: 'TR33 0006 1005 1978 6457 8413 26',
      currency: 'USD',
    });
    expect(ok.iban).toBe('TR330006100519786457841326');
    expect(bankAccountSchema.safeParse({ bankName: 'X', accountName: 'Y', currency: 'USD' }).success).toBe(
      false,
    );
  });
});

describe('roles', () => {
  it('only reference known permissions', () => {
    for (const role of DEFAULT_ROLES) for (const p of role.permissions) expect(ALL_PERMISSIONS).toContain(p);
  });
  it('keep costs away from sales and viewers', () => {
    const find = (code: string) => DEFAULT_ROLES.find((r) => r.code === code)!;
    expect(find('SALES').permissions).not.toContain('finance.view_costs');
    expect(find('VIEWER').permissions).not.toContain('finance.view_costs');
    expect(find('SALES').permissions).not.toContain('customer.view_all');
    expect(find('ADMIN').permissions).toEqual(ALL_PERMISSIONS);
  });
});
