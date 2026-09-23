'use client';

import type { PurchaseOrderListItemDto } from '@fillco/contracts';
import { PURCHASE_ORDER_STATUSES } from '@fillco/domain';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { ListPage } from '@/components/list-page';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox, Select } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/misc';
import { useAuth } from '@/lib/auth';
import { date, humanize, money, pct } from '@/lib/format';

export default function PurchasesPage() {
  const { can } = useAuth();
  return (
    <>
      <PageHeader
        title="Purchase orders"
        subtitle="Supplier orders in Turkey, China and elsewhere, and the customer orders they serve"
        actions={
          <>
            <Link href="/purchases/awaiting">
              <Button>Awaiting purchase</Button>
            </Link>
            {can('purchase_order.manage') && (
              <Link href="/purchases/new">
                <Button variant="primary">
                  <Plus className="h-4 w-4" /> New purchase order
                </Button>
              </Link>
            )}
          </>
        }
      />
      <ListPage<PurchaseOrderListItemDto>
        endpoint="/purchase-orders"
        searchPlaceholder="PO no., supplier ref, supplier, product…"
        rowKey={(r) => r.id}
        rowHref={(r) => `/purchases/${r.id}`}
        filters={(state, set) => (
          <>
            <Select
              aria-label="Status"
              value={state.status ?? ''}
              onChange={(e) => set({ status: e.target.value })}
              className="w-48"
            >
              <option value="">All statuses</option>
              <option value="DRAFT,SENT,CONFIRMED,IN_PRODUCTION,READY">Open</option>
              {PURCHASE_ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </Select>
            <Checkbox
              label="Delayed only"
              checked={state.delayed === 'true'}
              onChange={(e) => set({ delayed: e.target.checked ? 'true' : null })}
              className="h-9"
            />
          </>
        )}
        columns={[
          { key: 'n', header: 'PO', sortKey: 'number', cell: (r) => r.number },
          {
            key: 's',
            header: 'Supplier',
            sortKey: 'supplier',
            cell: (r) => (
              <span>
                {r.supplier.name} <span className="text-xs text-muted">{r.supplierCountry}</span>
                {r.supplierRef && <span className="block text-xs text-muted">Ref {r.supplierRef}</span>}
              </span>
            ),
          },
          { key: 'd', header: 'Date', sortKey: 'poDate', cell: (r) => date(r.poDate) },
          {
            key: 'v',
            header: 'Value',
            sortKey: 'grandTotalBase',
            align: 'right',
            cell: (r) => (r.grandTotal === null ? '—' : money(r.grandTotal, r.currency)),
          },
          { key: 'st', header: 'Status', sortKey: 'status', cell: (r) => <StatusBadge status={r.status} /> },
          {
            key: 'ready',
            header: 'Ready',
            sortKey: 'expectedReadyDate',
            cell: (r) => (
              <span>
                {date(r.expectedReadyDate)} {r.isDelayed && <Badge tone="critical">Delayed</Badge>}
              </span>
            ),
          },
          { key: 'a', header: 'Allocated', align: 'right', cell: (r) => pct(r.allocatedPct, 0) },
          {
            key: 'so',
            header: 'For orders',
            cell: (r) => (
              <span className="text-xs">{r.salesOrders.map((s) => s.code).join(', ') || 'Stock'}</span>
            ),
          },
        ]}
      />
    </>
  );
}
