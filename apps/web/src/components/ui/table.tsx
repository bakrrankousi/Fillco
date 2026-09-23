'use client';

import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './button';
import { Spinner } from './misc';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Field name sent as ?sort= when the header is clicked. */
  sortKey?: string;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowHref,
  sort,
  onSort,
  loading,
  empty = 'Nothing here yet.',
  dense,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowHref?: (row: T) => string;
  sort?: string;
  onSort?: (sort: string) => void;
  loading?: boolean;
  empty?: ReactNode;
  dense?: boolean;
}) {
  const active = sort?.replace(/^-/, '');
  const desc = sort?.startsWith('-');
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line bg-slate-50/80 text-left text-xs font-medium tracking-wide text-muted uppercase">
            {columns.map((c) => {
              const sortable = !!c.sortKey && !!onSort;
              const isActive = sortable && active === c.sortKey;
              return (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    'px-3 py-2 font-medium whitespace-nowrap',
                    c.align === 'right' && 'text-right',
                    c.align === 'center' && 'text-center',
                    c.className,
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => onSort!(isActive && !desc ? `-${c.sortKey}` : c.sortKey!)}
                      className={cn(
                        'inline-flex items-center gap-1 uppercase hover:text-ink',
                        isActive && 'text-ink',
                      )}
                    >
                      {c.header}
                      {isActive &&
                        (desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const href = rowHref?.(row);
            return (
              <tr
                key={rowKey(row)}
                className={cn(
                  'border-b border-line last:border-0',
                  href && 'cursor-pointer hover:bg-brand-50/40',
                )}
              >
                {columns.map((c, i) => (
                  <td
                    key={c.key}
                    className={cn(
                      dense ? 'px-3 py-1.5' : 'px-3 py-2.5',
                      'align-middle',
                      c.align === 'right' && 'num',
                      c.align === 'center' && 'text-center',
                      c.className,
                    )}
                  >
                    {href && i === 0 ? (
                      <Link
                        href={href}
                        className="font-medium whitespace-nowrap text-brand-700 hover:underline"
                      >
                        {c.cell(row)}
                      </Link>
                    ) : (
                      c.cell(row)
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && !loading && (
        <div className="px-4 py-10 text-center text-sm text-muted">{empty}</div>
      )}
      {loading && (
        <div className="absolute inset-0 flex items-start justify-center bg-white/50 pt-10">
          <Spinner />
        </div>
      )}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between border-t border-line px-3 py-2 text-xs text-muted">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span>
          Page {page} / {pages}
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/** Search box + filters row above a list. */
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-end gap-2 border-b border-line p-3">{children}</div>;
}
