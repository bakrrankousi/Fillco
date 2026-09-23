import { describe, expect, it } from 'vitest';
import {
  addDays,
  buildInstallmentSchedule,
  describeInstallments,
  diffDays,
  InvalidPaymentTermError,
  isIsoDate,
  nextBusinessDay,
  todayInTimeZone,
  validateInstallmentRules,
} from '../src';

describe('dates', () => {
  it('adds calendar days across month ends and leap years', () => {
    expect(addDays('2026-09-01', 60)).toBe('2026-10-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(diffDays('2026-09-01', '2026-10-31')).toBe(60);
  });
  it('validates ISO dates strictly', () => {
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-2-3')).toBe(false);
    expect(isIsoDate('2026-02-28')).toBe(true);
  });
  it('rolls weekends to the next business day', () => {
    expect(nextBusinessDay('2026-10-31')).toBe('2026-11-02'); // Saturday → Monday
  });
  it('computes today in the company timezone', () => {
    const now = new Date('2026-09-22T22:30:00Z');
    expect(todayInTimeZone('Europe/Istanbul', now)).toBe('2026-09-23');
    expect(todayInTimeZone('America/New_York', now)).toBe('2026-09-22');
  });
});

describe('payment term schedules', () => {
  it('invoice date + 60 days', () => {
    const [i] = buildInstallmentSchedule([{ percent: 100, triggerEvent: 'INVOICE_DATE', offsetDays: 60 }], {
      total: '50000',
      eventDates: { INVOICE_DATE: '2026-09-01' },
    });
    expect(i?.dueDate).toBe('2026-10-31');
    expect(i?.dueStatus).toBe('FIXED');
    expect(i?.amount.toFixed(2)).toBe('50000.00');
  });

  it('30% advance / 70% against BL keeps the BL part pending with an estimate', () => {
    const s = buildInstallmentSchedule(
      [
        { percent: 30, triggerEvent: 'ORDER_CONFIRMATION', offsetDays: 0 },
        { percent: 70, triggerEvent: 'BL_DATE', offsetDays: 0 },
      ],
      {
        total: '100000',
        eventDates: { ORDER_CONFIRMATION: '2026-09-05' },
        estimatedEventDates: { BL_DATE: '2026-10-10' },
      },
    );
    expect(s.map((x) => x.amount.toFixed(2))).toEqual(['30000.00', '70000.00']);
    expect(s[0]?.dueDate).toBe('2026-09-05');
    expect(s[1]?.dueDate).toBeNull();
    expect(s[1]?.dueStatus).toBe('PENDING_EVENT');
    expect(s[1]?.estimatedDueDate).toBe('2026-10-10');
  });

  it('20% advance / 80% 60 days after BL once the BL date is known', () => {
    const s = buildInstallmentSchedule(
      [
        { percent: 20, triggerEvent: 'ORDER_CONFIRMATION', offsetDays: 0 },
        { percent: 80, triggerEvent: 'BL_DATE', offsetDays: 60 },
      ],
      { total: '75000', eventDates: { ORDER_CONFIRMATION: '2026-09-01', BL_DATE: '2026-10-05' } },
    );
    expect(s[1]?.dueDate).toBe('2026-12-04');
    expect(s[1]?.amount.toFixed(2)).toBe('60000.00');
  });

  it('gives the rounding remainder to the last installment', () => {
    const s = buildInstallmentSchedule(
      [
        { percent: '33.3333', triggerEvent: 'INVOICE_DATE', offsetDays: 0 },
        { percent: '33.3333', triggerEvent: 'INVOICE_DATE', offsetDays: 30 },
        { percent: '33.3334', triggerEvent: 'INVOICE_DATE', offsetDays: 60 },
      ],
      { total: '100.00' },
    );
    expect(s.map((x) => x.amount.toFixed(2))).toEqual(['33.33', '33.33', '33.34']);
  });

  it('rejects percentages that do not add up to 100', () => {
    expect(() =>
      validateInstallmentRules([
        { percent: 30, triggerEvent: 'ORDER_CONFIRMATION', offsetDays: 0 },
        { percent: 60, triggerEvent: 'BL_DATE', offsetDays: 0 },
      ]),
    ).toThrow(InvalidPaymentTermError);
    expect(() => validateInstallmentRules([])).toThrow(InvalidPaymentTermError);
    expect(() =>
      validateInstallmentRules([{ percent: 100, triggerEvent: 'BL_DATE', offsetDays: 1.5 }]),
    ).toThrow(InvalidPaymentTermError);
  });

  it('describes a term in words', () => {
    expect(
      describeInstallments([
        { percent: 30, triggerEvent: 'ORDER_CONFIRMATION', offsetDays: 0 },
        { percent: 70, triggerEvent: 'BL_DATE', offsetDays: 60 },
      ]),
    ).toBe('30% at order confirmation, 70% 60 days after BL date');
  });
});
