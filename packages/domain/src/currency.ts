import { dec, Decimal, DecimalInput, roundMoney, roundTo } from './decimal';
import { IsoDate } from './dates';

/** FX rates are stored as "units of `to` per 1 unit of `from`" with 10 decimals. */
export const FX_RATE_DECIMALS = 10;

export interface ExchangeRateRecord {
  rateDate: IsoDate;
  fromCurrency: string;
  toCurrency: string;
  rate: DecimalInput;
}

export class MissingExchangeRateError extends Error {
  constructor(
    readonly fromCurrency: string,
    readonly toCurrency: string,
    readonly onDate: IsoDate,
  ) {
    super(`No exchange rate ${fromCurrency}→${toCurrency} on or before ${onDate}`);
    this.name = 'MissingExchangeRateError';
  }
}

/**
 * Finds the rate to convert `from` into `to` on a date: the latest rate dated on or before
 * `onDate`, either direct (from→to) or inverted (to→from). Same currency is always 1.
 */
export function resolveRate(
  rates: readonly ExchangeRateRecord[],
  from: string,
  to: string,
  onDate: IsoDate,
): Decimal {
  if (from === to) return new Decimal(1);
  let best: { date: IsoDate; rate: Decimal } | undefined;
  for (const r of rates) {
    if (r.rateDate > onDate) continue;
    let candidate: Decimal | undefined;
    if (r.fromCurrency === from && r.toCurrency === to) candidate = dec(r.rate);
    else if (r.fromCurrency === to && r.toCurrency === from && !dec(r.rate).isZero())
      candidate = new Decimal(1).div(dec(r.rate));
    if (!candidate) continue;
    // Prefer the newest date; on the same date prefer a direct quote over an inverted one.
    if (!best || r.rateDate > best.date || (r.rateDate === best.date && r.fromCurrency === from)) {
      best = { date: r.rateDate, rate: candidate };
    }
  }
  if (!best) throw new MissingExchangeRateError(from, to, onDate);
  return roundTo(best.rate, FX_RATE_DECIMALS);
}

/** amount (transaction currency) × rate (base per 1 unit) → base amount, rounded to base minor units. */
export function toBase(amount: DecimalInput, fxRate: DecimalInput, baseMinorUnits = 2): Decimal {
  return roundMoney(dec(amount).times(dec(fxRate)), baseMinorUnits);
}

/** Converts between two arbitrary currencies through their rates to base. */
export function convertViaBase(
  amount: DecimalInput,
  fromRateToBase: DecimalInput,
  toRateToBase: DecimalInput,
  toMinorUnits = 2,
): Decimal {
  if (dec(toRateToBase).isZero()) throw new RangeError('Target rate cannot be zero');
  return roundMoney(dec(amount).times(dec(fromRateToBase)).div(dec(toRateToBase)), toMinorUnits);
}
