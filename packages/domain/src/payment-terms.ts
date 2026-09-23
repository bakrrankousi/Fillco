import { dec, Decimal, DecimalInput, roundMoney, sum } from './decimal';
import { addDays, IsoDate, nextBusinessDay } from './dates';

/** The business event an installment's due date is counted from. */
export const TRIGGER_EVENTS = [
  'ORDER_CONFIRMATION',
  'BEFORE_LOADING',
  'INVOICE_DATE',
  'BL_DATE',
  'ETA',
  'ARRIVAL',
  'DELIVERY',
] as const;
export type TriggerEvent = (typeof TRIGGER_EVENTS)[number];

export const PAYMENT_INSTRUMENTS = ['TT', 'CAD', 'LC', 'CASH', 'CHEQUE'] as const;
export type PaymentInstrument = (typeof PAYMENT_INSTRUMENTS)[number];

export const TRIGGER_EVENT_LABELS: Record<TriggerEvent, string> = {
  ORDER_CONFIRMATION: 'order confirmation',
  BEFORE_LOADING: 'before loading',
  INVOICE_DATE: 'invoice date',
  BL_DATE: 'BL date',
  ETA: 'ETA',
  ARRIVAL: 'arrival',
  DELIVERY: 'delivery',
};

export interface InstallmentRule {
  percent: DecimalInput;
  triggerEvent: TriggerEvent;
  /** Calendar days after the trigger event (negative = before, e.g. "7 days before loading"). */
  offsetDays: number;
  instrument?: PaymentInstrument | null;
}

export type EventDates = Partial<Record<TriggerEvent, IsoDate | null | undefined>>;

export interface ScheduledInstallment {
  seq: number;
  percent: Decimal;
  amount: Decimal;
  triggerEvent: TriggerEvent;
  offsetDays: number;
  instrument: PaymentInstrument | null;
  /** Firm due date, known once the trigger event has happened. */
  dueDate: IsoDate | null;
  /** Due date calculated from the planned event date, for forecasting while the event is pending. */
  estimatedDueDate: IsoDate | null;
  dueStatus: 'FIXED' | 'PENDING_EVENT';
}

export class InvalidPaymentTermError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPaymentTermError';
  }
}

/** Throws unless the installments are a valid schedule: each 0 < % ≤ 100, summing to exactly 100. */
export function validateInstallmentRules(rules: readonly InstallmentRule[]): void {
  if (rules.length === 0) throw new InvalidPaymentTermError('A payment term needs at least one installment');
  for (const [i, r] of rules.entries()) {
    const p = dec(r.percent);
    if (p.lte(0) || p.gt(100))
      throw new InvalidPaymentTermError(`Installment ${i + 1}: percent must be > 0 and ≤ 100`);
    if (p.decimalPlaces() > 4)
      throw new InvalidPaymentTermError(`Installment ${i + 1}: percent allows at most 4 decimals`);
    if (!Number.isInteger(r.offsetDays) || r.offsetDays < -365 || r.offsetDays > 730)
      throw new InvalidPaymentTermError(
        `Installment ${i + 1}: offset days must be a whole number (-365…730)`,
      );
    if (!TRIGGER_EVENTS.includes(r.triggerEvent))
      throw new InvalidPaymentTermError(
        `Installment ${i + 1}: unknown trigger event ${String(r.triggerEvent)}`,
      );
  }
  const total = sum(rules.map((r) => r.percent));
  if (!total.eq(100))
    throw new InvalidPaymentTermError(
      `Installment percentages must add up to 100 (currently ${total.toString()})`,
    );
}

export interface ScheduleOptions {
  /** Document total the percentages apply to. */
  total: DecimalInput;
  minorUnits?: number;
  /** Actual dates of events that have happened. */
  eventDates?: EventDates;
  /** Planned dates (BL ≈ ETD, arrival ≈ ETA) used only for estimated due dates. */
  estimatedEventDates?: EventDates;
  /** Move due dates falling on weekends to the next business day. */
  rollToBusinessDay?: boolean;
  weekendDays?: readonly number[];
}

/**
 * Builds a dated installment schedule. Amounts are rounded per installment and the last
 * installment absorbs the rounding remainder, so the schedule always sums to the total.
 *
 * Example: 60 days after invoice dated 2026-09-01 → due 2026-10-31.
 * Example: 20% advance / 80% 60 days after BL; BL unknown → 80% is PENDING_EVENT until the BL date is set.
 */
export function buildInstallmentSchedule(
  rules: readonly InstallmentRule[],
  options: ScheduleOptions,
): ScheduledInstallment[] {
  validateInstallmentRules(rules);
  const minorUnits = options.minorUnits ?? 2;
  const total = roundMoney(options.total, minorUnits);
  if (total.isNegative()) throw new RangeError('Total cannot be negative');

  const due = (eventDate: IsoDate | null | undefined, offset: number): IsoDate | null => {
    if (!eventDate) return null;
    const d = addDays(eventDate, offset);
    return options.rollToBusinessDay ? nextBusinessDay(d, options.weekendDays) : d;
  };

  let allocated = new Decimal(0);
  return rules.map((rule, index) => {
    const percent = dec(rule.percent);
    const isLast = index === rules.length - 1;
    const amount = isLast ? total.minus(allocated) : roundMoney(total.times(percent).div(100), minorUnits);
    allocated = allocated.plus(amount);

    const actual = options.eventDates?.[rule.triggerEvent];
    const planned = options.estimatedEventDates?.[rule.triggerEvent];
    const dueDate = due(actual, rule.offsetDays);
    return {
      seq: index + 1,
      percent,
      amount,
      triggerEvent: rule.triggerEvent,
      offsetDays: rule.offsetDays,
      instrument: rule.instrument ?? null,
      dueDate,
      estimatedDueDate: dueDate ?? due(planned, rule.offsetDays),
      dueStatus: dueDate ? 'FIXED' : 'PENDING_EVENT',
    };
  });
}

/** Human description, e.g. "30% at order confirmation, 70% 60 days after BL date". */
export function describeInstallments(rules: readonly InstallmentRule[]): string {
  return rules
    .map((r) => {
      const pct = `${dec(r.percent).toString()}%`;
      const event = TRIGGER_EVENT_LABELS[r.triggerEvent];
      if (r.offsetDays === 0) return `${pct} at ${event}`;
      if (r.offsetDays < 0) return `${pct} ${-r.offsetDays} days before ${event}`;
      return `${pct} ${r.offsetDays} days after ${event}`;
    })
    .join(', ');
}
