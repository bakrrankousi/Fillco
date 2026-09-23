'use client';

import type { Page } from '@fillco/contracts';
import { Download, Search } from 'lucide-react';
import { ReactNode, Suspense, useEffect, useState } from 'react';
import { downloadExport } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePagedList, useUrlState } from '@/lib/queries';
import { useToast } from './toast';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/form';
import { ErrorBox, Loading } from './ui/misc';
import { Column, DataTable, Pagination, Toolbar } from './ui/table';

/** Search box that writes to the URL after a short pause. */
export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    const t = setTimeout(() => text !== value && onChange(text), 300);
    return () => clearTimeout(t);
  }, [text, value, onChange]);
  return (
    <div className="relative w-64">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className="pl-8"
        aria-label="Search list"
      />
    </div>
  );
}

export function ExportButton({
  endpoint,
  query,
}: {
  endpoint: string;
  query: Record<string, string | undefined>;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!can('export.data')) return null;
  return (
    <Button
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await downloadExport(endpoint, query);
        } catch (err) {
          toast.error(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Download className="h-4 w-4" /> Excel
    </Button>
  );
}

function ListInner<T>({
  endpoint,
  columns,
  rowKey,
  rowHref,
  filters,
  searchPlaceholder,
  defaults,
  empty,
}: ListProps<T>) {
  const [state, set] = useUrlState(defaults);
  const query = Object.fromEntries(Object.entries(state).filter(([, v]) => v !== '')) as Record<
    string,
    string | undefined
  >;
  const list = usePagedList<T>(endpoint, query);
  const data: Page<T> | undefined = list.data;
  return (
    <Card>
      <Toolbar>
        <SearchInput value={state.q ?? ''} onChange={(q) => set({ q })} placeholder={searchPlaceholder} />
        {filters?.(state, set)}
        <div className="ml-auto">
          <ExportButton endpoint={endpoint} query={query} />
        </div>
      </Toolbar>
      {list.error ? (
        <ErrorBox error={list.error} className="m-3" />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={data.items}
            rowKey={rowKey}
            rowHref={rowHref}
            sort={state.sort}
            onSort={(sort) => set({ sort })}
            loading={list.isFetching && list.isPlaceholderData}
            empty={empty}
          />
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPage={(p) => set({ page: String(p) }, false)}
          />
        </>
      )}
    </Card>
  );
}

interface ListProps<T> {
  endpoint: string;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  rowHref?: (row: T) => string;
  filters?: (
    state: Record<string, string>,
    set: (patch: Record<string, string | null | undefined>) => void,
  ) => ReactNode;
  searchPlaceholder: string;
  defaults?: Record<string, string>;
  empty?: ReactNode;
}

/** Standard server-side list: search, filters, sortable columns, pagination and Excel export. */
export function ListPage<T>(props: ListProps<T>) {
  return (
    <Suspense fallback={<Loading />}>
      <ListInner {...props} />
    </Suspense>
  );
}
