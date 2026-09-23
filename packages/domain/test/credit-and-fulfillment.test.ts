import { describe, expect, it } from 'vitest';
import {
  AllocationError,
  assertAllocation,
  deriveSalesOrderStatus,
  evaluateCredit,
  maxAllocatable,
  soLineProgress,
} from '../src';

const base = {
  creditLimit: '100000',
  openAr: '60000',
  overdueAmount: '0',
  maxDaysOverdue: 0,
  openOrders: '0',
  unappliedCredit: '0',
  customerStatus: 'ACTIVE',
};

describe('customer credit exposure', () => {
  it('matches the specification example (limit 100k, outstanding 60k, new order 30k)', () => {
    const r = evaluateCredit({ ...base, newOrderValue: '30000' });
    expect(r.result).toBe('PASS');
    expect(r.availableBefore.toFixed(2)).toBe('40000.00');
    expect(r.availableAfter.toFixed(2)).toBe('10000.00');
  });
  it('warns when the new order exceeds available credit', () => {
    const r = evaluateCredit({ ...base, newOrderValue: '45000' });
    expect(r.result).toBe('WARN');
    expect(r.excess.toFixed(2)).toBe('5000.00');
  });
  it('counts open orders and deducts unapplied advances', () => {
    const r = evaluateCredit({ ...base, openOrders: '25000', unappliedCredit: '10000', newOrderValue: '20000' });
    expect(r.exposure.toFixed(2)).toBe('75000.00');
    expect(r.availableAfter.toFixed(2)).toBe('5000.00');
  });
  it('does not consume credit for the part paid in advance', () => {
    const r = evaluateCredit({ ...base, creditLimit: '0', openAr: '0', newOrderValue: '50000', securedPct: 100 });
    expect(r.result).toBe('PASS');
    const partial = evaluateCredit({ ...base, newOrderValue: '50000', securedPct: 30 });
    expect(partial.newOrderUnsecured.toFixed(2)).toBe('35000.00');
    expect(partial.result).toBe('PASS');
  });
  it('blocks customers on hold or with old overdue amounts', () => {
    expect(evaluateCredit({ ...base, newOrderValue: '1', customerStatus: 'ON_HOLD' }).result).toBe('BLOCK');
    expect(
      evaluateCredit({ ...base, newOrderValue: '1', overdueAmount: '5000', maxDaysOverdue: 45 }).result,
    ).toBe('BLOCK');
    expect(
      evaluateCredit({ ...base, newOrderValue: '1', overdueAmount: '5000', maxDaysOverdue: 10 }).result,
    ).toBe('PASS');
  });
});

describe('partial quantities', () => {
  it('ordered 100 MT, shipped 40 → remaining 60', () => {
    const p = soLineProgress({
      ordered: '100000',
      purchasedCommitted: '100000',
      purchasedPending: '0',
      shipped: '40000',
      lineStatus: 'OPEN',
    });
    expect(p.remainingToShip.toString()).toBe('60000');
    expect(p.fullyShipped).toBe(false);
  });
  it('treats quantities within tolerance as complete', () => {
    const p = soLineProgress({
      ordered: '100000',
      purchasedCommitted: '96000',
      purchasedPending: '0',
      shipped: '96000',
      tolerancePct: 5,
      lineStatus: 'OPEN',
    });
    expect(p.fullyPurchased).toBe(true);
    expect(p.fullyShipped).toBe(true);
    expect(p.remainingToShip.toString()).toBe('4000');
  });
  it('closed-short lines have nothing remaining', () => {
    const p = soLineProgress({ ordered: 100, purchasedCommitted: 60, purchasedPending: 0, lineStatus: 'CLOSED_SHORT' });
    expect(p.remainingToPurchase.toString()).toBe('0');
    expect(p.fullyPurchased).toBe(true);
  });
});

describe('allocation caps', () => {
  const c = { soLineOrdered: '100000', soLineTolerancePct: '5', soLineAllocated: '60000', poLineQty: '50000', poLineAllocated: '0' };
  it('allows up to ordered + tolerance and PO availability', () => {
    expect(maxAllocatable(c).toString()).toBe('45000');
    expect(() => assertAllocation({ ...c, qty: '45000' })).not.toThrow();
  });
  it('rejects over-allocation on either side', () => {
    expect(() => assertAllocation({ ...c, qty: '45001' })).toThrow(AllocationError);
    expect(() => assertAllocation({ ...c, poLineAllocated: '10000', qty: '40001' })).toThrow(/Purchase order line/);
    expect(() => assertAllocation({ ...c, qty: '0' })).toThrow(AllocationError);
  });
});

describe('derived sales order status', () => {
  const line = (over: Partial<Parameters<typeof soLineProgress>[0]> = {}) => ({
    ordered: '50000',
    purchasedCommitted: '0',
    purchasedPending: '0',
    lineStatus: 'OPEN' as const,
    ...over,
  });
  it('follows the stored status before confirmation', () => {
    expect(deriveSalesOrderStatus('DRAFT', [line()]).display).toBe('DRAFT');
    expect(deriveSalesOrderStatus('CANCELLED', [line()]).display).toBe('CANCELLED');
    expect(deriveSalesOrderStatus('CLOSED', [line()]).display).toBe('COMPLETED');
  });
  it('walks through purchasing stages', () => {
    expect(deriveSalesOrderStatus('CONFIRMED', [line()]).display).toBe('PURCHASE_REQUIRED');
    expect(deriveSalesOrderStatus('CONFIRMED', [line({ purchasedPending: '50000' })]).display).toBe('PURCHASING');
    const partial = deriveSalesOrderStatus('CONFIRMED', [line({ purchasedCommitted: '50000' }), line()]);
    expect(partial.display).toBe('PARTIALLY_PURCHASED');
    expect(partial.purchasedPct.toString()).toBe('50');
    expect(
      deriveSalesOrderStatus('CONFIRMED', [line({ purchasedCommitted: '50000' }), line({ purchasedCommitted: '50000' })])
        .display,
    ).toBe('FULLY_PURCHASED');
  });
  it('shipping stages take precedence over purchasing', () => {
    const full = line({ purchasedCommitted: '50000' });
    expect(deriveSalesOrderStatus('CONFIRMED', [{ ...full, shipmentInPreparation: true }]).display).toBe(
      'PREPARING_SHIPMENT',
    );
    expect(deriveSalesOrderStatus('CONFIRMED', [{ ...full, shipped: '20000' }]).display).toBe('PARTIALLY_SHIPPED');
    expect(deriveSalesOrderStatus('CONFIRMED', [{ ...full, shipped: '50000' }]).display).toBe('FULLY_SHIPPED');
    expect(deriveSalesOrderStatus('CONFIRMED', [{ ...full, shipped: '50000', delivered: '50000' }]).display).toBe(
      'DELIVERED',
    );
  });
  it('ignores cancelled lines', () => {
    const s = deriveSalesOrderStatus('CONFIRMED', [
      line({ purchasedCommitted: '50000' }),
      line({ lineStatus: 'CANCELLED' }),
    ]);
    expect(s.display).toBe('FULLY_PURCHASED');
    expect(s.ordered.toString()).toBe('50000');
  });
});
