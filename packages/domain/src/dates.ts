/**
 * Business dates are calendar dates without time or zone, carried as ISO strings "YYYY-MM-DD".
 * All arithmetic is done in UTC so daylight-saving changes can never shift a due date.
 */
export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export function isIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

export function assertIsoDate(value: string): IsoDate {
  if (!isIsoDate(value)) throw new RangeError(`Invalid date "${value}", expected YYYY-MM-DD`);
  return value;
}

function toUtcMs(date: IsoDate): number {
  assertIsoDate(date);
  return Date.parse(`${date}T00:00:00.000Z`);
}

export function fromUtcMs(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Converts a JS Date holding a DB `date` value (midnight UTC) to an ISO date string. */
export function dateToIso(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

export function isoToDate(date: IsoDate): Date {
  return new Date(toUtcMs(date));
}

export function addDays(date: IsoDate, days: number): IsoDate {
  if (!Number.isInteger(days)) throw new RangeError('days must be an integer');
  return fromUtcMs(toUtcMs(date) + days * MS_PER_DAY);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function diffDays(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / MS_PER_DAY);
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Saturday/Sunday. Configurable weekends (e.g. Fri/Sat) can be passed in. */
export function nextBusinessDay(date: IsoDate, weekendDays: readonly number[] = [0, 6]): IsoDate {
  let d = date;
  while (weekendDays.includes(new Date(toUtcMs(d)).getUTCDay())) d = addDays(d, 1);
  return d;
}

/** "Today" as seen in the company's timezone (e.g. Europe/Istanbul). */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): IsoDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function yearOf(date: IsoDate): number {
  return Number(assertIsoDate(date).slice(0, 4));
}
