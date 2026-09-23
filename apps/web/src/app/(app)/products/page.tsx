'use client';

import type { ProductListItemDto } from '@fillco/contracts';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { ListPage } from '@/components/list-page';
import { useCategories } from '@/components/product-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/misc';
import { useAuth } from '@/lib/auth';

export default function ProductsPage() {
  const { can } = useAuth();
  const categories = useCategories();
  return (
    <>
      <PageHeader
        title="Products"
        subtitle="Product master with flexible specifications. Each specification combination becomes a variant (SKU)."
        actions={
          can('product.manage') && (
            <Link href="/products/new">
              <Button variant="primary">
                <Plus className="h-4 w-4" /> New product
              </Button>
            </Link>
          )
        }
      />
      <ListPage<ProductListItemDto>
        endpoint="/products"
        searchPlaceholder="Name, code, HS code, variant, SKU…"
        rowKey={(r) => r.id}
        rowHref={(r) => `/products/${r.id}`}
        filters={(state, set) => (
          <>
            <Select
              aria-label="Category"
              value={state.categoryId ?? ''}
              onChange={(e) => set({ categoryId: e.target.value })}
              className="w-60"
            >
              <option value="">All categories</option>
              {categories.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.path}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Active"
              value={state.active ?? ''}
              onChange={(e) => set({ active: e.target.value })}
              className="w-32"
            >
              <option value="">All</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </Select>
          </>
        )}
        columns={[
          { key: 'name', header: 'Product', sortKey: 'name', cell: (r) => r.name },
          {
            key: 'code',
            header: 'Code',
            sortKey: 'code',
            cell: (r) => <span className="text-muted">{r.code}</span>,
          },
          { key: 'cat', header: 'Category', cell: (r) => r.categoryPath },
          { key: 'uom', header: 'Sales unit', cell: (r) => r.defaultSalesUom },
          { key: 'hs', header: 'HS code', cell: (r) => r.hsCode ?? '—' },
          { key: 'variants', header: 'Variants', align: 'right', cell: (r) => r.variantCount },
          {
            key: 'active',
            header: 'Status',
            cell: (r) =>
              r.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="muted">Inactive</Badge>,
          },
        ]}
      />
    </>
  );
}
