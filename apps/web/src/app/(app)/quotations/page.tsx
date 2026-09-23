'use client';

import type { QuotationListItemDto } from '@fillco/contracts';
import { QUOTATION_STATUSES } from '@fillco/domain';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { ListPage } from '@/components/list-page';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/misc';
import { useAuth } from '@/lib/auth';
import { date, humanize, money } from '@/lib/format';

export default function QuotationsPage() {
  const { can } = useAuth();
  return (
    <>
      <PageHeader
        title="Quotations"
        subtitle="Offers to customers with revision history; accepted offers convert into sales orders"
        actions={
          can('quotation.manage') && (
            <Link href="/quotations/new">
              <Button variant="primary">
                <Plus className="h-4 w-4" /> New quotation
              </Button>
            </Link>
          )
        }
      />
      <ListPage<QuotationListItemDto>
        endpoint="/quotations"
        searchPlaceholder="Quotation number or customer…"
        rowKey={(r) => r.id}
        rowHref={(r) => `/quotations/${r.id}`}
        filters={(state, set) => (
          <Select
            aria-label="Status"
            value={state.status ?? ''}
            onChange={(e) => set({ status: e.target.value })}
            className="w-40"
          >
            <option value="">Current (all but superseded)</option>
            {QUOTATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </Select>
        )}
        columns={[
          {
            key: 'n',
            header: 'Quotation',
            sortKey: 'number',
            cell: (r) => `${r.number}${r.revision > 1 ? ` rev ${r.revision}` : ''}`,
          },
          { key: 'c', header: 'Customer', sortKey: 'customer', cell: (r) => r.customer.name },
          { key: 'd', header: 'Date', sortKey: 'quotationDate', cell: (r) => date(r.quotationDate) },
          {
            key: 'v',
            header: 'Valid until',
            sortKey: 'validUntil',
            cell: (r) => <span className={r.isExpired ? 'text-orange-700' : ''}>{date(r.validUntil)}</span>,
          },
          {
            key: 't',
            header: 'Value',
            sortKey: 'grandTotal',
            align: 'right',
            cell: (r) => money(r.grandTotal, r.currency),
          },
          {
            key: 's',
            header: 'Status',
            sortKey: 'status',
            cell: (r) => <StatusBadge status={r.isExpired ? 'EXPIRED' : r.status} />,
          },
          { key: 'p', header: 'Salesperson', cell: (r) => r.salesperson ?? '—' },
        ]}
      />
    </>
  );
}
