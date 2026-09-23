'use client';

import type { DocumentLineDto } from '@fillco/contracts';
import { ReactNode } from 'react';
import { money, num } from '@/lib/format';
import { Column, DataTable } from './ui/table';

/** Read-only line table for quotations and orders. Extra columns can be appended. */
export function DocumentLinesTable<T extends DocumentLineDto>({
  lines,
  currency,
  extra = [],
  footer,
}: {
  lines: T[];
  currency: string;
  extra?: Column<T>[];
  footer?: ReactNode;
}) {
  const columns: Column<T>[] = [
    { key: 'no', header: '#', cell: (l) => <span className="text-muted">{l.lineNo}</span>, className: 'w-8' },
    {
      key: 'desc',
      header: 'Product & specification',
      cell: (l) => (
        <div>
          <div className="font-medium text-ink">{l.description}</div>
          <div className="text-xs text-muted">
            {l.sku}
            {l.packagingType ? ` · ${l.packagingType.name}` : ''}
            {l.notes ? ` · ${l.notes}` : ''}
          </div>
        </div>
      ),
    },
    { key: 'qty', header: 'Quantity', align: 'right', cell: (l) => `${num(l.qty, 4)} ${l.uom}` },
    {
      key: 'price',
      header: 'Unit price',
      align: 'right',
      cell: (l) => (l.unitPrice === null ? '—' : money(l.unitPrice, null, 2)),
    },
    {
      key: 'disc',
      header: 'Disc.',
      align: 'right',
      cell: (l) => (Number(l.discountPct) ? `${num(l.discountPct)}%` : ''),
    },
    ...extra,
    {
      key: 'total',
      header: `Total ${currency}`,
      align: 'right',
      cell: (l) => <span className="font-medium">{money(l.lineTotal)}</span>,
    },
  ];
  return (
    <>
      <DataTable columns={columns} rows={lines} rowKey={(l) => l.id} />
      {footer && <div className="flex justify-end border-t border-line px-3 py-2">{footer}</div>}
    </>
  );
}

export function Totals({ rows }: { rows: [ReactNode, ReactNode, boolean?][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-0.5 text-right text-sm">
      {rows.map(([k, v, strong], i) => (
        <div key={i} className="contents">
          <dt className={strong ? 'font-medium' : 'text-muted'}>{k}</dt>
          <dd className={strong ? 'font-semibold tabular-nums' : 'tabular-nums'}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
