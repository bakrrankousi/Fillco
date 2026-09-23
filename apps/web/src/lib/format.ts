import type { SoDisplayStatus } from '@fillco/domain';
import { SO_DISPLAY_STATUS_LABELS } from '@fillco/domain';

const moneyFormatters = new Map<string, Intl.NumberFormat>();

/** "USD 12,345.00" — amounts arrive as decimal strings and are only formatted for display. */
export function money(
  value: string | number | null | undefined,
  currency?: string | null,
  decimals = 2,
): string {
  if (value === null || value === undefined || value === '') return '—';
  const key = `${decimals}`;
  let fmt = moneyFormatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    moneyFormatters.set(key, fmt);
  }
  const n = Number(value);
  const text = Number.isFinite(n) ? fmt.format(n) : String(value);
  return currency ? `${currency} ${text}` : text;
}

export function num(value: string | number | null | undefined, maxDecimals = 3): string {
  if (value === null || value === undefined || value === '') return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: maxDecimals }).format(Number(value));
}

/** Base quantities are kilograms; trading is discussed in metric tons. */
export function mt(kg: string | number | null | undefined): string {
  if (kg === null || kg === undefined || kg === '') return '—';
  return `${num(Number(kg) / 1000, 3)} MT`;
}

export function qtyWithUnit(qty: string, uom: string): string {
  return `${num(qty, 4)} ${uom}`;
}

export function pct(value: string | number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || value === '') return '—';
  return `${Number(value).toFixed(decimals).replace(/\.0+$/, '')}%`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09-01" → "01 Sep 2026" (unambiguous for an international team). */
export function date(value: string | null | undefined): string {
  if (!value) return '—';
  const [y, m, d] = value.slice(0, 10).split('-');
  // Non-breaking spaces keep a date on one line in narrow table columns.
  return `${d}\u00a0${MONTHS[Number(m) - 1]}\u00a0${y}`;
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return `${date(d.toISOString().slice(0, 10))} ${d.toTimeString().slice(0, 5)}`;
}

export function monthLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-');
  return `${MONTHS[Number(m) - 1]} ${y?.slice(2)}`;
}

export function humanize(code: string | null | undefined): string {
  if (!code) return '—';
  const s = code
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function soStatusLabel(status: SoDisplayStatus): string {
  return SO_DISPLAY_STATUS_LABELS[status];
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
