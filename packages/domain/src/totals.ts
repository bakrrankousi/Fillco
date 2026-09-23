import { dec, Decimal, DecimalInput, roundMoney, sum } from './decimal';

export interface LineInput {
  qty: DecimalInput;
  unitPrice: DecimalInput;
  /** Percentage 0–100. */
  discountPct?: DecimalInput;
  /** Percentage 0–100. Export sales are normally 0. */
  taxRatePct?: DecimalInput;
}

export interface LineTotals {
  gross: Decimal;
  discount: Decimal;
  net: Decimal;
  tax: Decimal;
}

export function assertPercent(value: DecimalInput, label = 'percentage'): Decimal {
  const d = dec(value);
  if (d.isNegative() || d.greaterThan(100)) throw new RangeError(`${label} must be between 0 and 100`);
  return d;
}

/**
 * line net = round(qty × price × (1 − discount%)); each line is rounded to the currency minor units
 * and document totals are sums of rounded lines, so printed documents always add up.
 */
export function computeLineTotals(line: LineInput, minorUnits = 2): LineTotals {
  const qty = dec(line.qty);
  const price = dec(line.unitPrice);
  if (qty.isNegative()) throw new RangeError('Quantity cannot be negative');
  if (price.isNegative()) throw new RangeError('Unit price cannot be negative');
  const discountPct = assertPercent(line.discountPct ?? 0, 'Discount');
  const taxPct = assertPercent(line.taxRatePct ?? 0, 'Tax rate');

  const gross = roundMoney(qty.times(price), minorUnits);
  const net = roundMoney(qty.times(price).times(new Decimal(100).minus(discountPct)).div(100), minorUnits);
  const discount = gross.minus(net);
  const tax = roundMoney(net.times(taxPct).div(100), minorUnits);
  return { gross, discount, net, tax };
}

export interface DocumentCharges {
  headerDiscount?: DecimalInput;
  freight?: DecimalInput;
  insurance?: DecimalInput;
  otherCharges?: DecimalInput;
}

export interface DocumentTotals {
  /** Σ line gross (before line discounts). */
  grossTotal: Decimal;
  /** Σ line discounts + header discount. */
  discountTotal: Decimal;
  /** Σ line net. */
  subtotal: Decimal;
  freight: Decimal;
  insurance: Decimal;
  otherCharges: Decimal;
  taxTotal: Decimal;
  /** subtotal − header discount + freight + insurance + other + tax. */
  grandTotal: Decimal;
}

export function computeDocumentTotals(
  lines: readonly LineInput[],
  charges: DocumentCharges = {},
  minorUnits = 2,
): DocumentTotals {
  const computed = lines.map((l) => computeLineTotals(l, minorUnits));
  const headerDiscount = roundMoney(charges.headerDiscount ?? 0, minorUnits);
  const freight = roundMoney(charges.freight ?? 0, minorUnits);
  const insurance = roundMoney(charges.insurance ?? 0, minorUnits);
  const otherCharges = roundMoney(charges.otherCharges ?? 0, minorUnits);
  for (const [label, v] of [
    ['Header discount', headerDiscount],
    ['Freight', freight],
    ['Insurance', insurance],
    ['Other charges', otherCharges],
  ] as const) {
    if (v.isNegative()) throw new RangeError(`${label} cannot be negative`);
  }

  const grossTotal = sum(computed.map((c) => c.gross));
  const subtotal = sum(computed.map((c) => c.net));
  const taxTotal = sum(computed.map((c) => c.tax));
  const discountTotal = sum(computed.map((c) => c.discount)).plus(headerDiscount);
  if (headerDiscount.greaterThan(subtotal)) throw new RangeError('Header discount exceeds subtotal');
  const grandTotal = subtotal.minus(headerDiscount).plus(freight).plus(insurance).plus(otherCharges).plus(taxTotal);
  return {
    grossTotal,
    discountTotal,
    subtotal,
    freight,
    insurance,
    otherCharges,
    taxTotal,
    grandTotal,
  };
}
