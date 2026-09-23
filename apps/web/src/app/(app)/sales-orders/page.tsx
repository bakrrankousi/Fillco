'use client';

import type { SalesOrderListItemDto } from '@fillco/contracts';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { ListPage } from '@/components/list-page';
import { SoStatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';
import { PageHeader, ProgressBar } from '@/components/ui/misc';
import { useAuth } from '@/lib/auth';
import { date, money, pct } from '@/lib/format';

const STATUS_FILTERS: [string, string][] = [
  ['', 'All orders'],
  ['CONFIRMED,ON_HOLD', 'Open (confirmed / on hold)'],
  ['DRAFT,PENDING_CONFIRMATION', 'Not yet confirmed'],
  ['CONFIRMED', 'Confirmed'],
  ['ON_HOLD', 'On hold'],
  ['CLOSED', 'Completed'],
  ['CANCELLED', 'Cancelled'],
];

export default function SalesOrdersPage() {
  const { can } = useAuth();
  return (
    <>
      <PageHeader
        title="Sales orders"
        subtitle="Customer orders with their purchasing progress"
        actions={
          <>
            {can('purchase_order.view') && (
              <Link href="/purchases/awaiting">
                <Button>Awaiting purchase</Button>
              </Link>
            )}
            {can('sales_order.manage') && (
              <Link href="/sales-orders/new">
                <Button variant="primary">
                  <Plus className="h-4 w-4" /> New order
                </Button>
              </Link>
            )}
          </>
        }
      />
      <ListPage<SalesOrderListItemDto>
        endpoint="/sales-orders"
        searchPlaceholder="Order no., customer PO, customer, product…"
        rowKey={(r) => r.id}
        rowHref={(r) => `/sales-orders/${r.id}`}
        filters={(state, set) => (
          <>
            <Select
              aria-label="Status"
              value={state.status ?? ''}
              onChange={(e) => set({ status: e.target.value })}
              className="w-56"
            >
              {STATUS_FILTERS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
            <Input
              type="date"
              aria-label="From date"
              value={state.from ?? ''}
              onChange={(e) => set({ from: e.target.value })}
              className="w-40"
            />
            <Input
              type="date"
              aria-label="To date"
              value={state.to ?? ''}
              onChange={(e) => set({ to: e.target.value })}
              className="w-40"
            />
          </>
        )}
        columns={[
          { key: 'n', header: 'Order', sortKey: 'number', cell: (r) => r.number },
          {
            key: 'c',
            header: 'Customer',
            sortKey: 'customer',
            cell: (r) => (
              <span>
                {r.customer.name} <span className="text-xs text-muted">{r.customerCountry}</span>
                {r.customerPoRef && <span className="block text-xs text-muted">PO {r.customerPoRef}</span>}
              </span>
            ),
          },
          { key: 'd', header: 'Date', sortKey: 'orderDate', cell: (r) => date(r.orderDate) },
          {
            key: 'v',
            header: 'Value',
            sortKey: 'grandTotalBase',
            align: 'right',
            cell: (r) => money(r.grandTotal, r.currency),
          },
          { key: 's', header: 'Status', cell: (r) => <SoStatusBadge status={r.displayStatus} /> },
          {
            key: 'p',
            header: 'Purchased',
            cell: (r) =>
              ['DRAFT', 'PENDING_CONFIRMATION', 'CANCELLED'].includes(r.status) ? (
                <span className="text-muted">—</span>
              ) : (
                <div className="w-28">
                  <ProgressBar value={Number(r.purchasedPct)} />
                  <span className="text-xs text-muted">{pct(r.purchasedPct, 0)}</span>
                </div>
              ),
          },
          {
            key: 'ship',
            header: 'Ship by',
            sortKey: 'requestedShipmentDate',
            cell: (r) => date(r.requestedShipmentDate),
          },
          { key: 'sp', header: 'Salesperson', cell: (r) => r.salesperson ?? '—' },
        ]}
      />
    </>
  );
}
