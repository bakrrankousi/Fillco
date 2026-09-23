import { Prisma } from '@fillco/db';
import { dateToIso } from '@fillco/domain';

/** Decimal → plain string ("1150.5"), never exponent notation. */
export function d(value: Prisma.Decimal | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toFixed();
}

export function dReq(value: Prisma.Decimal): string {
  return value.toFixed();
}

/** DB `date` → "YYYY-MM-DD". */
export function day(value: Date | null | undefined): string | null {
  return value ? dateToIso(value) : null;
}

export function dayReq(value: Date): string {
  return dateToIso(value);
}

export function ts(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function tsReq(value: Date): string {
  return value.toISOString();
}

export function ref<
  T extends {
    id: string;
    name?: string | null;
    companyName?: string | null;
    fullName?: string | null;
    code?: string | null;
    number?: string | null;
    locode?: string | null;
  },
>(row: T | null | undefined): { id: string; code?: string | null; name: string } | null {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code ?? row.number ?? row.locode ?? null,
    name: row.companyName ?? row.fullName ?? row.name ?? row.number ?? row.id,
  };
}

export function refReq<T extends Parameters<typeof ref>[0] & object>(
  row: T,
): { id: string; code?: string | null; name: string } {
  return ref(row)!;
}
