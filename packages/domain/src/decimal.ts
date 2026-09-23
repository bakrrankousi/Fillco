import DecimalJs from 'decimal.js';

/**
 * Isolated Decimal constructor for all money and quantity math.
 * Never use JavaScript numbers for money: 0.1 + 0.2 !== 0.3.
 */
export const Decimal = DecimalJs.clone({ precision: 40, rounding: DecimalJs.ROUND_HALF_UP });
export type Decimal = InstanceType<typeof Decimal>;

/** Anything that can be turned into a Decimal. Strings are the canonical wire format. */
export type DecimalInput = Decimal | string | number | { toString(): string };

export function dec(value: DecimalInput | null | undefined): Decimal {
  if (value === null || value === undefined || value === '') return new Decimal(0);
  if (value instanceof Decimal) return value;
  return new Decimal(typeof value === 'number' ? value : value.toString());
}

export const ZERO = new Decimal(0);

/** Round to a number of decimal places, half-up (commercial rounding). */
export function roundTo(value: DecimalInput, places: number): Decimal {
  return dec(value).toDecimalPlaces(places, Decimal.ROUND_HALF_UP);
}

/** Round money to the currency's minor units (USD 2, JPY 0, KWD 3). */
export function roundMoney(value: DecimalInput, minorUnits = 2): Decimal {
  return roundTo(value, minorUnits);
}

/** Fixed-point string for transport/storage, e.g. "1234.50". */
export function toFixedString(value: DecimalInput, places: number): string {
  return roundTo(value, places).toFixed(places);
}

export function sum(values: Iterable<DecimalInput>): Decimal {
  let total = ZERO;
  for (const v of values) total = total.plus(dec(v));
  return total;
}

export function max(a: DecimalInput, b: DecimalInput): Decimal {
  return Decimal.max(dec(a), dec(b));
}

export function min(a: DecimalInput, b: DecimalInput): Decimal {
  return Decimal.min(dec(a), dec(b));
}
