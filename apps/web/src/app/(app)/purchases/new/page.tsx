'use client';

import type { PurchaseOrderDto } from '@fillco/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { PurchaseOrderForm } from '@/components/purchase-order-form';
import { RequirePermission } from '@/components/shell';
import { useToast } from '@/components/toast';
import { PageHeader } from '@/components/ui/misc';
import { api } from '@/lib/api';

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  return (
    <RequirePermission permission="purchase_order.manage">
      <PageHeader
        title="New purchase order"
        subtitle="For stock or to allocate later. To buy for specific customer orders, use Awaiting purchase."
        breadcrumb={{ label: 'Purchase orders', href: '/purchases' }}
      />
      <PurchaseOrderForm
        submitLabel="Save draft PO"
        onCancel={() => router.back()}
        onSubmit={async (body) => {
          const po = await api.post<PurchaseOrderDto>('/purchase-orders', body);
          await qc.invalidateQueries({ queryKey: ['/purchase-orders'] });
          toast.success(`Purchase order ${po.number} created`);
          router.push(`/purchases/${po.id}`);
        }}
      />
    </RequirePermission>
  );
}
