'use client';

import type { ProductDto } from '@fillco/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ProductForm } from '@/components/product-form';
import { RequirePermission } from '@/components/shell';
import { useToast } from '@/components/toast';
import { Card, CardBody } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/misc';
import { api } from '@/lib/api';

export default function NewProductPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  return (
    <RequirePermission permission="product.manage">
      <PageHeader title="New product" breadcrumb={{ label: 'Products', href: '/products' }} />
      <Card>
        <CardBody>
          <ProductForm
            submitLabel="Create product"
            onCancel={() => router.back()}
            onSubmit={async (body) => {
              const p = await api.post<ProductDto>('/products', body);
              await qc.invalidateQueries({ queryKey: ['/products'] });
              await qc.invalidateQueries({ queryKey: ['products'] });
              toast.success(`Product ${p.code} created`);
              router.push(`/products/${p.id}`);
            }}
          />
        </CardBody>
      </Card>
    </RequirePermission>
  );
}
