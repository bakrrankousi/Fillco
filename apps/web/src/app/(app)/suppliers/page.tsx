'use client';

import type { SupplierListItemDto } from '@fillco/contracts';
import { SUPPLIER_TYPES } from '@fillco/domain';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { ListPage } from '@/components/list-page';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/misc';
import { useAuth } from '@/lib/auth';
import { humanize } from '@/lib/format';

export default function SuppliersPage() {
  const { can } = useAuth();
  return (
    <>
      <PageHeader
        title="Suppliers"
        subtitle="Material suppliers and service providers (forwarders, brokers, inspection)"
        actions={
          can('supplier.create') && (
            <Link href="/suppliers/new">
              <Button variant="primary">
                <Plus className="h-4 w-4" /> New supplier
              </Button>
            </Link>
          )
        }
      />
      <ListPage<SupplierListItemDto>
        endpoint="/suppliers"
        searchPlaceholder="Name, code, phone, e-mail, contact…"
        rowKey={(r) => r.id}
        rowHref={(r) => `/suppliers/${r.id}`}
        filters={(state, set) => (
          <>
            <Select
              aria-label="Type"
              value={state.supplierType ?? ''}
              onChange={(e) => set({ supplierType: e.target.value })}
              className="w-44"
            >
              <option value="">All types</option>
              {SUPPLIER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Country"
              value={state.countryCode ?? ''}
              onChange={(e) => set({ countryCode: e.target.value })}
              className="w-36"
            >
              <option value="">All countries</option>
              <option value="TR">Türkiye</option>
              <option value="CN">China</option>
            </Select>
          </>
        )}
        columns={[
          { key: 'name', header: 'Supplier', sortKey: 'companyName', cell: (r) => r.companyName },
          {
            key: 'code',
            header: 'Code',
            sortKey: 'code',
            cell: (r) => <span className="text-muted">{r.code}</span>,
          },
          { key: 'type', header: 'Type', sortKey: 'supplierType', cell: (r) => humanize(r.supplierType) },
          {
            key: 'country',
            header: 'Country',
            sortKey: 'countryCode',
            cell: (r) => `${r.countryCode}${r.city ? ` · ${r.city}` : ''}`,
          },
          { key: 'terms', header: 'Payment terms', cell: (r) => r.paymentTerm ?? '—' },
          {
            key: 'lead',
            header: 'Lead time',
            align: 'right',
            cell: (r) => (r.productionLeadTimeDays != null ? `${r.productionLeadTimeDays} d` : '—'),
          },
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
