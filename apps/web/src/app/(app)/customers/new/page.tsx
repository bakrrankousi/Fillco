'use client';

import type { CustomerDto } from '@fillco/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { RequirePermission } from '@/components/shell';
import { CustomerForm } from '@/components/party-forms';
import { useToast } from '@/components/toast';
import { Card, CardBody } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/misc';
import { api } from '@/lib/api';

export default function NewCustomerPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  return (
    <RequirePermission permission="customer.create">
      <PageHeader title="New customer" breadcrumb={{ label: 'Customers', href: '/customers' }} />
      <Card>
        <CardBody>
          <CustomerForm
            submitLabel="Create customer"
            onCancel={() => router.back()}
            onSubmit={async (body) => {
              const c = await api.post<CustomerDto>('/customers', body);
              await qc.invalidateQueries({ queryKey: ['/customers'] });
              toast.success(`Customer ${c.code} created`);
              router.push(`/customers/${c.id}`);
            }}
          />
        </CardBody>
      </Card>
    </RequirePermission>
  );
}
