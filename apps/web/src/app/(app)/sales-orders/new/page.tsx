'use client';

import type { SalesOrderDto } from '@fillco/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { SalesOrderForm } from '@/components/sales-order-form';
import { RequirePermission } from '@/components/shell';
import { useToast } from '@/components/toast';
import { PageHeader } from '@/components/ui/misc';
import { api } from '@/lib/api';

function NewOrder() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  return (
    <SalesOrderForm
      initialCustomerId={params.get('customerId') ?? undefined}
      submitLabel="Save draft order"
      onCancel={() => router.back()}
      onSubmit={async (body) => {
        const so = await api.post<SalesOrderDto>('/sales-orders', body);
        await qc.invalidateQueries({ queryKey: ['/sales-orders'] });
        toast.success(`Sales order ${so.number} created`);
        router.push(`/sales-orders/${so.id}`);
      }}
    />
  );
}

export default function NewSalesOrderPage() {
  return (
    <RequirePermission permission="sales_order.manage">
      <PageHeader title="New sales order" breadcrumb={{ label: 'Sales orders', href: '/sales-orders' }} />
      <Suspense>
        <NewOrder />
      </Suspense>
    </RequirePermission>
  );
}
