'use client';

import type { SupplierDto } from '@fillco/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { SupplierForm } from '@/components/party-forms';
import { RequirePermission } from '@/components/shell';
import { useToast } from '@/components/toast';
import { Card, CardBody } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/misc';
import { api } from '@/lib/api';

export default function NewSupplierPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  return (
    <RequirePermission permission="supplier.create">
      <PageHeader title="New supplier" breadcrumb={{ label: 'Suppliers', href: '/suppliers' }} />
      <Card>
        <CardBody>
          <SupplierForm
            submitLabel="Create supplier"
            onCancel={() => router.back()}
            onSubmit={async (body) => {
              const s = await api.post<SupplierDto>('/suppliers', body);
              await qc.invalidateQueries({ queryKey: ['/suppliers'] });
              toast.success(`Supplier ${s.code} created`);
              router.push(`/suppliers/${s.id}`);
            }}
          />
        </CardBody>
      </Card>
    </RequirePermission>
  );
}
