import { dec, Decimal, DecimalInput, roundTo } from './decimal';

/** Quantities are stored with 4 decimals, both in the line unit and in the product base unit. */
export const QTY_DECIMALS = 4;

/** Mass units convertible to the base unit KG. Factor = KG per 1 unit. */
export const MASS_UNITS = {
  KG: '1',
  MT: '1000',
  LB: '0.45359237',
} as const;

export type MassUnit = keyof typeof MASS_UNITS;

export function isMassUnit(code: string): code is MassUnit {
  return Object.prototype.hasOwnProperty.call(MASS_UNITS, code);
}

/** Converts a quantity in `uom` into base units using a factor (base units per 1 `uom`). */
export function toBaseQty(qty: DecimalInput, factorToBase: DecimalInput): Decimal {
  return roundTo(dec(qty).times(dec(factorToBase)), QTY_DECIMALS);
}

export function fromBaseQty(qtyBase: DecimalInput, factorToBase: DecimalInput): Decimal {
  if (dec(factorToBase).isZero()) throw new RangeError('Unit factor cannot be zero');
  return roundTo(dec(qtyBase).div(dec(factorToBase)), QTY_DECIMALS);
}
