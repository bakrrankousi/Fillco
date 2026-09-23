import { dec, Decimal, DecimalInput, sum } from './decimal';

export const CREDIT_RESULTS = ['PASS', 'WARN', 'BLOCK'] as const;
export type CreditResult = (typeof CREDIT_RESULTS)[number];

export interface CreditInput {
  /** All amounts must already be in the credit-limit currency. */
  creditLimit: DecimalInput;
  /** Outstanding on posted invoices (overdue + not yet due). */
  openAr: DecimalInput;
  /** Part of openAr that is past due. */
  overdueAmount: DecimalInput;
  /** Oldest overdue item, in days (0 if nothing overdue). */
  maxDaysOverdue: number;
  /** Uninvoiced value of other confirmed orders. */
  openOrders: DecimalInput;
  /** Unallocated payments and advances already received. */
  unappliedCredit: DecimalInput;
  /** Value of the order being checked. */
  newOrderValue: DecimalInput;
  /**
   * Percentage of the new order payable before goods leave (advance / before-loading installments).
   * That part is secured by the payment terms and does not consume credit.
   */
  securedPct?: DecimalInput;
  customerStatus: string;
  /** Overdue older than this blocks new orders regardless of limit. */
  blockOverdueDays?: number;
}

export interface CreditEvaluation {
  result: CreditResult;
  reasons: string[];
  creditLimit: Decimal;
  openAr: Decimal;
  overdueAmount: Decimal;
  openOrders: Decimal;
  unappliedCredit: Decimal;
  /** openAr + openOrders − unappliedCredit (before the new order). */
  exposure: Decimal;
  /** creditLimit − exposure. */
  availableBefore: Decimal;
  newOrderValue: Decimal;
  /** Part of the new order that consumes credit. */
  newOrderUnsecured: Decimal;
  /** availableBefore − newOrderUnsecured. */
  availableAfter: Decimal;
  /** Amount by which the limit would be exceeded (0 when within limit). */
  excess: Decimal;
}

export const DEFAULT_BLOCK_OVERDUE_DAYS = 30;

/**
 * Credit exposure check run when a sales order is confirmed.
 * Example: limit 100,000, outstanding 60,000, new order 30,000 → available after 10,000 → PASS.
 */
export function evaluateCredit(input: CreditInput): CreditEvaluation {
  const creditLimit = dec(input.creditLimit);
  const openAr = dec(input.openAr);
  const overdueAmount = dec(input.overdueAmount);
  const openOrders = dec(input.openOrders);
  const unappliedCredit = dec(input.unappliedCredit);
  const newOrderValue = dec(input.newOrderValue);
  const securedPct = Decimal.min(Decimal.max(dec(input.securedPct ?? 0), 0), 100);
  const blockDays = input.blockOverdueDays ?? DEFAULT_BLOCK_OVERDUE_DAYS;

  const exposure = sum([openAr, openOrders]).minus(unappliedCredit);
  const availableBefore = creditLimit.minus(exposure);
  const newOrderUnsecured = newOrderValue.times(new Decimal(100).minus(securedPct)).div(100);
  const availableAfter = availableBefore.minus(newOrderUnsecured);
  const excess = availableAfter.isNegative() ? availableAfter.negated() : new Decimal(0);

  const reasons: string[] = [];
  let result: CreditResult = 'PASS';
  if (input.customerStatus === 'BLOCKED' || input.customerStatus === 'ON_HOLD') {
    result = 'BLOCK';
    reasons.push(`Customer status is ${input.customerStatus}`);
  }
  if (overdueAmount.gt(0) && input.maxDaysOverdue > blockDays) {
    result = 'BLOCK';
    reasons.push(`Overdue amount ${overdueAmount.toFixed(2)} older than ${blockDays} days`);
  }
  if (excess.gt(0)) {
    if (result === 'PASS') result = 'WARN';
    reasons.push(`Credit limit exceeded by ${excess.toFixed(2)}`);
  }
  return {
    result,
    reasons,
    creditLimit,
    openAr,
    overdueAmount,
    openOrders,
    unappliedCredit,
    exposure,
    availableBefore,
    newOrderValue,
    newOrderUnsecured,
    availableAfter,
    excess,
  };
}
