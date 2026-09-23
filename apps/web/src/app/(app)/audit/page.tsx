'use client';

import type { AuditLogDto } from '@fillco/contracts';
import { useQuery } from '@tanstack/react-query';
import { Suspense } from 'react';
import { ChangeList } from '@/components/audit-trail';
import { RequirePermission } from '@/components/shell';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { ErrorBox, Loading, PageHeader } from '@/components/ui/misc';
import { DataTable, Toolbar } from '@/components/ui/table';
import { api } from '@/lib/api';
import { dateTime, humanize } from '@/lib/format';
import { useLookups, useUrlState } from '@/lib/queries';

const ENTITIES = [
  'customer',
  'supplier',
  'supplier_bank_account',
  'product',
  'quotation',
  'sales_order',
  'purchase_order',
  'order_allocation',
  'exchange_rate',
  'payment_term',
  'user',
  'company',
];

function AuditInner() {
  const [state, set] = useUrlState();
  const lookups = useLookups();
  const logs = useQuery({
    queryKey: ['audit', state.entityType, state.userId],
    queryFn: () =>
      api.get<AuditLogDto[]>('/audit-logs', {
        entityType: state.entityType,
        userId: state.userId,
        take: 300,
      }),
  });
  return (
    <RequirePermission permission="audit.view">
      <PageHeader
        title="Audit log"
        subtitle="Every important change: who, when, what changed and why. Entries can never be edited or deleted."
      />
      <Card>
        <Toolbar>
          <Select
            aria-label="Record type"
            value={state.entityType ?? ''}
            onChange={(e) => set({ entityType: e.target.value })}
            className="w-56"
          >
            <option value="">All record types</option>
            {ENTITIES.map((e) => (
              <option key={e} value={e}>
                {humanize(e)}
              </option>
            ))}
          </Select>
          <Select
            aria-label="User"
            value={state.userId ?? ''}
            onChange={(e) => set({ userId: e.target.value })}
            className="w-56"
          >
            <option value="">All users</option>
            {lookups.data?.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Toolbar>
        {logs.error ? (
          <ErrorBox error={logs.error} className="m-3" />
        ) : !logs.data ? (
          <Loading />
        ) : (
          <DataTable
            rows={logs.data}
            rowKey={(l) => l.id}
            columns={[
              {
                key: 'w',
                header: 'When',
                cell: (l) => <span className="whitespace-nowrap">{dateTime(l.occurredAt)}</span>,
              },
              { key: 'u', header: 'User', cell: (l) => l.user?.name ?? 'system' },
              { key: 'r', header: 'Record', cell: (l) => humanize(l.entityType) },
              { key: 'a', header: 'Action', cell: (l) => humanize(l.action) },
              {
                key: 'c',
                header: 'Changes',
                cell: (l) => (
                  <div className="max-w-xl">
                    {l.reason && <p className="text-xs">Reason: {l.reason}</p>}
                    <ChangeList changes={l.changes} />
                  </div>
                ),
              },
            ]}
          />
        )}
      </Card>
    </RequirePermission>
  );
}

export default function AuditPage() {
  return (
    <Suspense fallback={<Loading />}>
      <AuditInner />
    </Suspense>
  );
}
