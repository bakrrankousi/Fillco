'use client';

import type { QuotationDto } from '@fillco/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { QuotationForm } from '@/components/quotation-form';
import { RequirePermission } from '@/components/shell';
import { useToast } from '@/components/toast';
import { PageHeader } from '@/components/ui/misc';
import { api } from '@/lib/api';

function NewQuotation() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  return (
    <QuotationForm
      initialCustomerId={params.get('customerId') ?? undefined}
      submitLabel="Create quotation"
      onCancel={() => router.back()}
      onSubmit={async (body) => {
        const q = await api.post<QuotationDto>('/quotations', body);
        await qc.invalidateQueries({ queryKey: ['/quotations'] });
        toast.success(`Quotation ${q.number} created`);
        router.push(`/quotations/${q.id}`);
      }}
    />
  );
}

export default function NewQuotationPage() {
  return (
    <RequirePermission permission="quotation.manage">
      <PageHeader title="New quotation" breadcrumb={{ label: 'Quotations', href: '/quotations' }} />
      <Suspense>
        <NewQuotation />
      </Suspense>
    </RequirePermission>
  );
}
