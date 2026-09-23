'use client';

import type {
  CategoryAttributeDto,
  DocumentLineDto,
  Page,
  ProductDto,
  ProductListItemDto,
} from '@fillco/contracts';
import { computeDocumentTotals, computeLineTotals } from '@fillco/domain';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import type { FieldErrors } from '@/lib/forms';
import { useLookups } from '@/lib/queries';
import { Button } from './ui/button';
import { Input, Select } from './ui/form';

export interface LineDraft {
  key: string;
  id?: string;
  productId: string;
  attributes: Record<string, string | number | boolean>;
  qty: string;
  uom: string;
  unitPrice: string;
  discountPct: string;
  packagingTypeId: string;
  description: string;
  notes: string;
  tolerancePct?: string;
  expectedReadyDate?: string;
  estUnitCost?: string;
}

let seq = 0;
export function newLine(partial: Partial<LineDraft> = {}): LineDraft {
  seq += 1;
  return {
    key: `l${Date.now()}${seq}`,
    productId: '',
    attributes: {},
    qty: '',
    uom: 'MT',
    unitPrice: '',
    discountPct: '0',
    packagingTypeId: '',
    description: '',
    notes: '',
    ...partial,
  };
}

/** Rebuilds editable drafts from a stored document line. */
export function lineFromDto(
  l: DocumentLineDto & {
    tolerancePct?: string;
    expectedReadyDate?: string | null;
    estUnitCost?: string | null;
  },
): LineDraft {
  return newLine({
    id: l.id,
    productId: l.productId,
    attributes: l.attributes,
    qty: l.qty,
    uom: l.uom,
    unitPrice: l.unitPrice ?? '',
    discountPct: l.discountPct,
    packagingTypeId: l.packagingType?.id ?? '',
    description: l.description,
    notes: l.notes ?? '',
    tolerancePct: l.tolerancePct,
    expectedReadyDate: l.expectedReadyDate ?? '',
    estUnitCost: l.estUnitCost ?? '',
  });
}

/** Converts drafts into the API line shape (description is sent only when edited). */
export function linesToInput(
  lines: LineDraft[],
  products: Map<string, ProductDto>,
  extra: (l: LineDraft) => Record<string, unknown> = () => ({}),
) {
  return lines.map((l) => {
    const product = products.get(l.productId);
    const fixed = product ? Object.keys(product.fixedAttributes) : [];
    const attributes = Object.fromEntries(
      Object.entries(l.attributes).filter(([k, v]) => !fixed.includes(k) && v !== ''),
    );
    return {
      ...(l.id ? { id: l.id } : {}),
      productId: l.productId,
      attributes,
      qty: l.qty,
      uom: l.uom,
      unitPrice: l.unitPrice,
      discountPct: l.discountPct || '0',
      packagingTypeId: l.packagingTypeId || null,
      description: l.description.trim() ? l.description : null,
      notes: l.notes || null,
      ...extra(l),
    };
  });
}

export function useProducts() {
  return useQuery({
    queryKey: ['products', 'active-all'],
    queryFn: () =>
      api.get<Page<ProductListItemDto>>('/products', { active: 'true', pageSize: 500, sort: 'name' }),
    staleTime: 5 * 60_000,
  });
}

/** Loads full product definitions (specification rules) for the products used on the lines. */
export function useProductDetails(ids: string[]): Map<string, ProductDto> {
  const unique = [...new Set(ids.filter(Boolean))];
  const results = useQueries({
    queries: unique.map((id) => ({
      queryKey: ['product', id],
      queryFn: () => api.get<ProductDto>(`/products/${id}`),
      staleTime: 5 * 60_000,
    })),
  });
  const map = new Map<string, ProductDto>();
  results.forEach((r) => r.data && map.set(r.data.id, r.data));
  return map;
}

function SpecInput({
  rule,
  value,
  onChange,
  error,
}: {
  rule: CategoryAttributeDto;
  value: string | number | boolean | undefined;
  onChange: (v: string | number | boolean) => void;
  error?: string;
}) {
  const a = rule.attribute;
  const label = `${a.label}${a.unit ? ` (${a.unit})` : ''}${rule.isRequired ? ' *' : ''}`;
  const common = { 'aria-invalid': !!error, 'aria-label': a.label, title: error ?? a.label };
  let control;
  if (a.dataType === 'ENUM') {
    control = (
      <Select
        {...common}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 text-xs"
      >
        <option value="">—</option>
        {a.enumOptions?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    );
  } else if (a.dataType === 'BOOLEAN') {
    control = (
      <Select
        {...common}
        value={value === undefined || value === '' ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? '' : e.target.value === 'true')}
        className="h-8 text-xs"
      >
        <option value="">—</option>
        <option value="true">{a.trueLabel ?? 'Yes'}</option>
        <option value="false">{a.falseLabel ?? 'No'}</option>
      </Select>
    );
  } else {
    control = (
      <Input
        {...common}
        inputMode={a.dataType === 'NUMBER' ? 'decimal' : undefined}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 text-xs"
      />
    );
  }
  return (
    <label className="block w-32">
      <span className="mb-0.5 block truncate text-[11px] text-muted">{label}</span>
      {control}
      {error && <span className="block truncate text-[11px] text-red-700">{error}</span>}
    </label>
  );
}

export function LineItemsEditor({
  lines,
  onChange,
  currency,
  errors,
  showCost,
  showTolerance,
  showReadyDate,
  lockedIds = [],
}: {
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  currency: string;
  errors: FieldErrors;
  showCost?: boolean;
  showTolerance?: boolean;
  showReadyDate?: boolean;
  /** Lines that cannot change product/spec (e.g. already allocated). */
  lockedIds?: string[];
}) {
  const lookups = useLookups();
  const products = useProducts();
  const details = useProductDetails(lines.map((l) => l.productId));
  const minor = lookups.data?.currencies.find((c) => c.code === currency)?.minorUnits ?? 2;
  const massUnits = lookups.data?.uoms.filter((u) => u.dimension === 'MASS') ?? [];

  const update = (key: string, patch: Partial<LineDraft>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const safeTotal = (l: LineDraft) => {
    try {
      if (!l.qty || !l.unitPrice) return null;
      return computeLineTotals(
        { qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct || '0' },
        minor,
      ).net.toFixed(minor);
    } catch {
      return null;
    }
  };
  let totals: ReturnType<typeof computeDocumentTotals> | null = null;
  try {
    totals = computeDocumentTotals(
      lines
        .filter((l) => l.qty && l.unitPrice)
        .map((l) => ({ qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct || '0' })),
      {},
      minor,
    );
  } catch {
    totals = null;
  }

  return (
    <div className="space-y-3">
      {lines.map((l, i) => {
        const product = details.get(l.productId);
        const locked = !!l.id && lockedIds.includes(l.id);
        const specRules =
          product?.specification.filter((r) => !(r.attribute.code in product.fixedAttributes)) ?? [];
        const err = (field: string) => errors[`lines.${i}.${field}`]?.[0];
        return (
          <div
            key={l.key}
            className="rounded-md border border-line bg-slate-50/50 p-3"
            data-testid={`line-${i}`}
          >
            <div className="flex flex-wrap items-end gap-2">
              <span className="mb-2 w-5 text-xs font-medium text-muted">{i + 1}</span>
              <label className="block min-w-56 flex-1">
                <span className="mb-0.5 block text-[11px] text-muted">Product *</span>
                <Select
                  aria-label={`Line ${i + 1} product`}
                  value={l.productId}
                  disabled={locked}
                  aria-invalid={!!err('productId')}
                  onChange={(e) => {
                    const p = products.data?.items.find((x) => x.id === e.target.value);
                    update(l.key, {
                      productId: e.target.value,
                      attributes: {},
                      uom: p?.defaultSalesUom ?? l.uom,
                    });
                  }}
                  className="h-8 text-sm"
                >
                  <option value="">Select a product…</option>
                  {products.data?.items.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.code})
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block w-24">
                <span className="mb-0.5 block text-[11px] text-muted">Quantity *</span>
                <Input
                  aria-label={`Line ${i + 1} quantity`}
                  inputMode="decimal"
                  value={l.qty}
                  onChange={(e) => update(l.key, { qty: e.target.value })}
                  aria-invalid={!!err('qty')}
                  className="h-8 text-right"
                />
              </label>
              <label className="block w-20">
                <span className="mb-0.5 block text-[11px] text-muted">Unit</span>
                <Select
                  aria-label={`Line ${i + 1} unit`}
                  value={l.uom}
                  onChange={(e) => update(l.key, { uom: e.target.value })}
                  className="h-8"
                >
                  {massUnits.map((u) => (
                    <option key={u.code} value={u.code}>
                      {u.code}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block w-28">
                <span className="mb-0.5 block text-[11px] text-muted">Price / {l.uom} *</span>
                <Input
                  aria-label={`Line ${i + 1} unit price`}
                  inputMode="decimal"
                  value={l.unitPrice}
                  onChange={(e) => update(l.key, { unitPrice: e.target.value })}
                  aria-invalid={!!err('unitPrice')}
                  className="h-8 text-right"
                />
              </label>
              <label className="block w-16">
                <span className="mb-0.5 block text-[11px] text-muted">Disc. %</span>
                <Input
                  inputMode="decimal"
                  value={l.discountPct}
                  onChange={(e) => update(l.key, { discountPct: e.target.value })}
                  className="h-8 text-right"
                />
              </label>
              {showTolerance && (
                <label className="block w-16">
                  <span className="mb-0.5 block text-[11px] text-muted">± Tol. %</span>
                  <Input
                    inputMode="decimal"
                    value={l.tolerancePct ?? ''}
                    placeholder="5"
                    onChange={(e) => update(l.key, { tolerancePct: e.target.value })}
                    className="h-8 text-right"
                  />
                </label>
              )}
              {showReadyDate && (
                <label className="block w-36">
                  <span className="mb-0.5 block text-[11px] text-muted">Ready date</span>
                  <Input
                    type="date"
                    value={l.expectedReadyDate ?? ''}
                    onChange={(e) => update(l.key, { expectedReadyDate: e.target.value })}
                    className="h-8"
                  />
                </label>
              )}
              {showCost && (
                <label className="block w-28">
                  <span className="mb-0.5 block text-[11px] text-muted">Est. cost / {l.uom}</span>
                  <Input
                    inputMode="decimal"
                    value={l.estUnitCost ?? ''}
                    onChange={(e) => update(l.key, { estUnitCost: e.target.value })}
                    className="h-8 text-right"
                  />
                </label>
              )}
              <div className="mb-1.5 w-32 text-right text-sm font-medium tabular-nums">
                {money(safeTotal(l), currency, minor)}
              </div>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove line ${i + 1}`}
                disabled={lines.length === 1 || locked}
                onClick={() => onChange(lines.filter((x) => x.key !== l.key))}
                className="mb-0.5"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {product && (
              <div className="mt-2 flex flex-wrap items-start gap-2 pl-7">
                {specRules.map((rule) => (
                  <SpecInput
                    key={rule.attribute.code}
                    rule={rule}
                    value={l.attributes[rule.attribute.code]}
                    onChange={(v) =>
                      update(l.key, { attributes: { ...l.attributes, [rule.attribute.code]: v } })
                    }
                    error={err(`attributes.${rule.attribute.code}`)}
                  />
                ))}
                <label className="block w-40">
                  <span className="mb-0.5 block text-[11px] text-muted">Packaging</span>
                  <Select
                    value={l.packagingTypeId}
                    onChange={(e) => update(l.key, { packagingTypeId: e.target.value })}
                    className="h-8 text-xs"
                  >
                    <option value="">—</option>
                    {lookups.data?.packagingTypes.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="block min-w-48 flex-1">
                  <span className="mb-0.5 block text-[11px] text-muted">
                    Description (auto from spec if empty)
                  </span>
                  <Input
                    value={l.description}
                    onChange={(e) => update(l.key, { description: e.target.value })}
                    className="h-8 text-xs"
                  />
                </label>
                {Object.keys(product.fixedAttributes).length > 0 && (
                  <p className="w-full text-[11px] text-muted">
                    Fixed for {product.name}:{' '}
                    {Object.entries(product.fixedAttributes)
                      .map(([k, v]) => {
                        const def = product.specification.find((r) => r.attribute.code === k)?.attribute;
                        const label =
                          def?.enumOptions?.find((o) => o.value === v)?.label ??
                          (typeof v === 'boolean' ? (v ? def?.trueLabel : def?.falseLabel) : String(v));
                        return `${def?.label ?? k}: ${label ?? v}`;
                      })
                      .join(' · ')}
                  </p>
                )}
              </div>
            )}
            {(err('productId') || err('qty') || err('unitPrice') || err('_')) && (
              <p className="mt-1 pl-7 text-xs text-red-700">
                {err('productId') ?? err('qty') ?? err('unitPrice')}
              </p>
            )}
          </div>
        );
      })}
      <div className="flex items-center justify-between">
        <Button size="sm" onClick={() => onChange([...lines, newLine({ uom: lines.at(-1)?.uom ?? 'MT' })])}>
          <Plus className="h-4 w-4" /> Add line
        </Button>
        {totals && (
          <dl className="grid grid-cols-2 gap-x-6 text-right text-sm">
            {!totals.discountTotal.isZero() && (
              <>
                <dt className="text-muted">Discount</dt>
                <dd className="tabular-nums">
                  −{money(totals.discountTotal.toFixed(minor), currency, minor)}
                </dd>
              </>
            )}
            <dt className="font-medium">Total</dt>
            <dd className="font-semibold tabular-nums">
              {money(totals.grandTotal.toFixed(minor), currency, minor)}
            </dd>
          </dl>
        )}
      </div>
    </div>
  );
}
