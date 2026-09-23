'use client';

import type { ProductDto } from '@fillco/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ProductForm } from '@/components/product-form';
import { useToast } from '@/components/toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { ErrorBox, KeyValues, Loading, PageHeader } from '@/components/ui/misc';
import { DataTable } from '@/components/ui/table';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date, humanize } from '@/lib/format';

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const product = useQuery({
    queryKey: ['product', id],
    queryFn: () => api.get<ProductDto>(`/products/${id}`),
  });
  if (product.error) return <ErrorBox error={product.error} />;
  if (!product.data) return <Loading />;
  const p = product.data;
  const label = (code: string, value: string | number | boolean) => {
    const a = p.specification.find((r) => r.attribute.code === code)?.attribute;
    if (!a) return String(value);
    if (a.dataType === 'ENUM') return a.enumOptions?.find((o) => o.value === value)?.label ?? String(value);
    if (a.dataType === 'BOOLEAN') return value ? (a.trueLabel ?? 'Yes') : (a.falseLabel ?? 'No');
    return `${value}${a.unit ?? ''}`;
  };
  return (
    <>
      <PageHeader
        breadcrumb={{ label: 'Products', href: '/products' }}
        title={
          <span className="flex items-center gap-2">
            {p.name}{' '}
            {p.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="muted">Inactive</Badge>}
          </span>
        }
        subtitle={`${p.code} · ${p.categoryPath}`}
        actions={
          can('product.manage') && (
            <Button variant="primary" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Product" />
          <CardBody>
            <KeyValues
              items={[
                ['Category', p.categoryPath],
                ['HS code', p.hsCode],
                ['Origin', p.countryOfOrigin ?? 'Varies by supplier'],
                [
                  'Units',
                  `Sales ${p.defaultSalesUom} · Purchase ${p.defaultPurchaseUom} · Base ${p.baseUom}`,
                ],
                ['Packaging', p.defaultPackagingType?.name],
                [
                  'Currencies',
                  [
                    p.defaultSalesCurrency && `Sales ${p.defaultSalesCurrency}`,
                    p.defaultPurchaseCurrency && `Purchase ${p.defaultPurchaseCurrency}`,
                  ]
                    .filter(Boolean)
                    .join(' · ') || null,
                ],
              ]}
            />
            {p.description && <p className="mt-4 text-sm text-slate-700">{p.description}</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Specification" subtitle="Fields captured on every order line" />
          <CardBody>
            <ul className="space-y-1.5 text-sm">
              {p.specification.map((r) => (
                <li key={r.attribute.code} className="flex items-center justify-between gap-2">
                  <span>
                    {r.attribute.label}
                    {r.attribute.unit ? ` (${r.attribute.unit})` : ''}{' '}
                    {r.isRequired && <span className="text-red-600">*</span>}
                  </span>
                  {r.attribute.code in p.fixedAttributes ? (
                    <Badge tone="info">
                      Fixed: {label(r.attribute.code, p.fixedAttributes[r.attribute.code]!)}
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted">{humanize(r.attribute.dataType)} · per order</span>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
      <Card className="mt-4">
        <CardHeader
          title="Variants"
          subtitle="Created automatically the first time a specification is used on a quotation or order"
        />
        <DataTable
          rows={p.variants}
          rowKey={(r) => r.id}
          empty="No variants yet — they appear when this product is first quoted, sold or purchased."
          columns={[
            {
              key: 'name',
              header: 'Variant',
              cell: (r) => <span className="font-medium">{r.displayName}</span>,
            },
            { key: 'sku', header: 'SKU', cell: (r) => <span className="font-mono text-xs">{r.sku}</span> },
            {
              key: 'spec',
              header: 'Specification',
              cell: (r) => (
                <span className="text-xs text-slate-600">
                  {Object.entries(r.attributes)
                    .map(
                      ([k, v]) =>
                        `${p.specification.find((s) => s.attribute.code === k)?.attribute.label ?? k}: ${label(k, v)}`,
                    )
                    .join(' · ')}
                </span>
              ),
            },
            { key: 'created', header: 'First used', cell: (r) => date(r.createdAt.slice(0, 10)) },
          ]}
        />
      </Card>
      <Dialog open={editing} onClose={() => setEditing(false)} title={`Edit ${p.name}`} size="lg">
        <ProductForm
          product={p}
          submitLabel="Save changes"
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            const { code: _c, ...rest } = body;
            const updated = await api.patch<ProductDto>(`/products/${p.id}`, {
              ...rest,
              ...(p.variants.length ? { fixedAttributes: undefined, categoryId: undefined } : {}),
              version: p.version,
            });
            qc.setQueryData(['product', id], updated);
            await qc.invalidateQueries({ queryKey: ['/products'] });
            setEditing(false);
            toast.success('Product saved');
          }}
        />
      </Dialog>
    </>
  );
}
