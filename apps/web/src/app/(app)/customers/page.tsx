'use client';

import type { CustomerListItemDto } from '@fillco/contracts';
import { CUSTOMER_STATUSES } from '@fillco/domain';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { ListPage } from '@/components/list-page';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/misc';
import { useAuth } from '@/lib/auth';
import { humanize, money } from '@/lib/format';
import { useLookups } from '@/lib/queries';

export default function CustomersPage() {
  const { can } = useAuth();
  const lookups = useLookups();
  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="Buyers, their credit limits, payment terms and contacts"
        actions={
          can('customer.create') && (
            <Link href="/customers/new">
              <Button variant="primary">
                <Plus className="h-4 w-4" /> New customer
              </Button>
            </Link>
          )
        }
      />
      <ListPage<CustomerListItemDto>
        endpoint="/customers"
        searchPlaceholder="Name, code, phone, e-mail, contact…"
        rowKey={(r) => r.id}
        rowHref={(r) => `/customers/${r.id}`}
        filters={(state, set) => (
          <>
            <Select
              aria-label="Status"
              value={state.status ?? ''}
              onChange={(e) => set({ status: e.target.value })}
              className="w-36"
            >
              <option value="">All statuses</option>
              {CUSTOMER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Country"
              value={state.countryCode ?? ''}
              onChange={(e) => set({ countryCode: e.target.value })}
              className="w-44"
            >
              <option value="">All countries</option>
              {lookups.data?.countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
          </>
        )}
        columns={[
          { key: 'name', header: 'Customer', sortKey: 'companyName', cell: (r) => r.companyName },
          {
            key: 'code',
            header: 'Code',
            sortKey: 'code',
            cell: (r) => <span className="text-muted">{r.code}</span>,
          },
          {
            key: 'country',
            header: 'Country',
            sortKey: 'countryCode',
            cell: (r) => `${r.countryCode}${r.city ? ` · ${r.city}` : ''}`,
          },
          { key: 'terms', header: 'Payment terms', cell: (r) => r.paymentTerm ?? '—' },
          {
            key: 'limit',
            header: 'Credit limit',
            sortKey: 'creditLimit',
            align: 'right',
            cell: (r) => money(r.creditLimit, r.creditLimitCurrency, 0),
          },
          { key: 'sales', header: 'Salesperson', cell: (r) => r.salesperson ?? '—' },
          {
            key: 'status',
            header: 'Status',
            sortKey: 'status',
            cell: (r) => <StatusBadge status={r.status} />,
          },
        ]}
      />
    </>
  );
}
