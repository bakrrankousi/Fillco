import { describe, expect, it } from 'vitest';
import {
  computeDocumentTotals,
  computeLineTotals,
  convertViaBase,
  dec,
  MissingExchangeRateError,
  resolveRate,
  roundMoney,
  toBase,
  toBaseQty,
} from '../src';

describe('money rounding', () => {
  it('avoids floating point errors', () => {
    expect(dec('0.1').plus('0.2').toString()).toBe('0.3');
  });
  it('rounds half-up to the currency minor units', () => {
    expect(roundMoney('2.345').toFixed(2)).toBe('2.35');
    expect(roundMoney('2.344').toFixed(2)).toBe('2.34');
    expect(roundMoney('1234.5', 0).toFixed(0)).toBe('1235');
  });
});

describe('order / purchase line totals', () => {
  it('multiplies quantity by price', () => {
    // 24 MT at 1,150 USD/MT
    expect(computeLineTotals({ qty: '24', unitPrice: '1150' }).net.toFixed(2)).toBe('27600.00');
  });
  it('applies a line discount and rounds per line', () => {
    const t = computeLineTotals({ qty: '3.333', unitPrice: '1.10', discountPct: '2.5' });
    expect(t.gross.toFixed(2)).toBe('3.67');
    expect(t.net.toFixed(2)).toBe('3.57');
    expect(t.discount.toFixed(2)).toBe('0.10');
  });
  it('rejects negative quantities and invalid discounts', () => {
    expect(() => computeLineTotals({ qty: '-1', unitPrice: '1' })).toThrow();
    expect(() => computeLineTotals({ qty: '1', unitPrice: '1', discountPct: '101' })).toThrow();
  });
  it('sums rounded lines and applies document charges', () => {
    const totals = computeDocumentTotals(
      [
        { qty: '40000', unitPrice: '1.12' },
        { qty: '20000', unitPrice: '1.35', discountPct: '1' },
      ],
      { freight: '2800', otherCharges: '150', headerDiscount: '500' },
    );
    expect(totals.subtotal.toFixed(2)).toBe('71530.00'); // 44,800 + 26,730
    expect(totals.discountTotal.toFixed(2)).toBe('770.00'); // 270 line + 500 header
    expect(totals.grandTotal.toFixed(2)).toBe('73980.00');
  });
  it('rejects a header discount larger than the subtotal', () => {
    expect(() => computeDocumentTotals([{ qty: 1, unitPrice: 10 }], { headerDiscount: 11 })).toThrow();
  });
});

describe('currency conversion', () => {
  const rates = [
    { rateDate: '2026-09-01', fromCurrency: 'EUR', toCurrency: 'USD', rate: '1.08' },
    { rateDate: '2026-09-15', fromCurrency: 'EUR', toCurrency: 'USD', rate: '1.10' },
    { rateDate: '2026-09-10', fromCurrency: 'USD', toCurrency: 'TRY', rate: '41.25' },
  ];
  it('uses the latest rate on or before the date', () => {
    expect(resolveRate(rates, 'EUR', 'USD', '2026-09-14').toString()).toBe('1.08');
    expect(resolveRate(rates, 'EUR', 'USD', '2026-09-15').toString()).toBe('1.1');
  });
  it('inverts a reverse quote', () => {
    expect(resolveRate(rates, 'TRY', 'USD', '2026-09-20').toFixed(10)).toBe('0.0242424242');
  });
  it('returns 1 for the same currency and fails when no rate exists', () => {
    expect(resolveRate([], 'USD', 'USD', '2026-01-01').toString()).toBe('1');
    expect(() => resolveRate(rates, 'EUR', 'USD', '2026-08-01')).toThrow(MissingExchangeRateError);
    expect(() => resolveRate(rates, 'CNY', 'USD', '2026-09-20')).toThrow(MissingExchangeRateError);
  });
  it('converts to base without losing the original amount', () => {
    const original = dec('10000');
    expect(toBase(original, '1.08').toFixed(2)).toBe('10800.00');
    expect(original.toString()).toBe('10000');
  });
  it('converts between two foreign currencies through base', () => {
    // 1,000 EUR → CNY with EUR=1.10 USD and CNY=0.14 USD
    expect(convertViaBase('1000', '1.10', '0.14').toFixed(2)).toBe('7857.14');
  });
});

describe('units', () => {
  it('converts MT to KG base', () => {
    expect(toBaseQty('24.5', '1000').toString()).toBe('24500');
    expect(toBaseQty('1', '0.45359237').toString()).toBe('0.4536');
  });
});
