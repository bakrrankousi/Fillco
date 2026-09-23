import { z } from 'zod';
import { isIsoDate } from '@fillco/domain';

/** Decimal numbers travel as strings to avoid floating point loss. Numbers are accepted and normalized. */
export const decimalString = (opts: { maxDecimals?: number; min?: number; allowNegative?: boolean } = {}) => {
  const maxDecimals = opts.maxDecimals ?? 4;
  return z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === 'number' ? String(v) : v.trim()))
    .refine((v) => new RegExp(`^${opts.allowNegative ? '-?' : ''}\\d{1,14}(\\.\\d{1,${maxDecimals}})?$`).test(v), {
      message: `Enter a number${opts.allowNegative ? '' : ' ≥ 0'} with at most ${maxDecimals} decimals`,
    })
    .refine((v) => opts.min === undefined || Number(v) >= opts.min, {
      message: `Must be at least ${opts.min}`,
    });
};

export const money = decimalString({ maxDecimals: 4 });
export const quantity = decimalString({ maxDecimals: 4 });
export const percent = decimalString({ maxDecimals: 4 }).refine((v) => Number(v) <= 100, 'Must be ≤ 100');
export const fxRate = decimalString({ maxDecimals: 10 }).refine((v) => Number(v) > 0, 'Rate must be > 0');

export const isoDate = z.string().refine(isIsoDate, 'Enter a date as YYYY-MM-DD');
export const uuid = z.string().uuid();
export const currencyCode = z
  .string()
  .length(3)
  .transform((v) => v.toUpperCase());
export const countryCode = z
  .string()
  .length(2)
  .transform((v) => v.toUpperCase());

/** Optional text: blank strings become null so "clearing" a field works from forms. */
export const optionalText = (max = 500) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v === null || v.trim() === '' ? null : v.trim()));

export const requiredText = (max = 200) => z.string().trim().min(1, 'Required').max(max);

export const optionalUuid = z
  .union([z.string().uuid(), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === '' ? null : v));

export const optionalDate = z
  .union([isoDate, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === '' ? null : v));

export const email = z.string().trim().toLowerCase().email();
export const optionalEmail = z
  .union([z.string().trim().toLowerCase().email(), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === '' ? null : v));

/** Optimistic locking: the version the client last saw. */
export const versioned = { version: z.number().int().nonnegative() };

export const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  /** Field name, prefixed with "-" for descending. */
  sort: z.string().max(50).optional(),
  format: z.enum(['json', 'xlsx']).default('json'),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** RFC 7807 problem details returned on every error. */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code?: string;
  errors?: Record<string, string[]>;
  /** Extra machine-readable data, e.g. the credit evaluation that blocked a confirmation. */
  data?: unknown;
}

export const reasonSchema = z.object({ reason: requiredText(1000) });
export type ReasonInput = z.infer<typeof reasonSchema>;
