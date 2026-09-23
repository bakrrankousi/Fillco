import type { ListQuery, Page } from '@fillco/contracts';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import type { Actor } from './actor';
import { ForbiddenError } from './errors';

export type SortDir = 'asc' | 'desc';

/** Maps "-orderDate" to a Prisma orderBy using a whitelist of sortable fields. */
export function orderBy<K extends string>(
  sort: string | undefined,
  allowed: Record<K, (dir: SortDir) => object>,
  fallback: object,
): object[] {
  if (!sort) return [fallback];
  const dir: SortDir = sort.startsWith('-') ? 'desc' : 'asc';
  const key = sort.replace(/^-/, '') as K;
  const build = allowed[key];
  return build ? [build(dir), fallback] : [fallback];
}

export function paging(q: ListQuery): { skip: number; take: number } {
  if (q.format === 'xlsx') return { skip: 0, take: 10_000 };
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}

export function page<T>(items: T[], total: number, q: ListQuery): Page<T> {
  return { items, total, page: q.page, pageSize: q.pageSize };
}

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number | Date | null | undefined;
  width?: number;
  /** Excel number format, e.g. '#,##0.00'. */
  numFmt?: string;
}

const NUMERIC = /^-?\d+(\.\d+)?$/;

/** Streams a typed .xlsx (numbers stay numbers, dates stay dates). */
export async function sendExcel<T>(
  res: Response,
  actor: Actor,
  filename: string,
  sheet: string,
  columns: ExportColumn<T>[],
  rows: T[],
): Promise<void> {
  if (!actor.permissions.has('export.data')) throw new ForbiddenError('You do not have permission to export data');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Fillco';
  wb.created = new Date();
  const ws = wb.addWorksheet(sheet, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, width: c.width ?? 16, style: c.numFmt ? { numFmt: c.numFmt } : {} }));
  for (const row of rows) {
    ws.addRow(
      columns.map((c) => {
        const v = c.value(row);
        if (typeof v === 'string' && c.numFmt && NUMERIC.test(v)) return Number(v);
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T00:00:00Z`);
        return v ?? null;
      }),
    );
  }
  ws.getRow(1).font = { bold: true };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  const buffer = await wb.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}-${new Date().toISOString().slice(0, 10)}.xlsx"`);
  res.send(Buffer.from(buffer as ArrayBuffer));
}

export const MONEY_FMT = '#,##0.00';
export const QTY_FMT = '#,##0.###';

/** Case-insensitive "contains" filter for Prisma. */
export function contains(q: string | undefined) {
  return q ? { contains: q, mode: 'insensitive' as const } : undefined;
}
