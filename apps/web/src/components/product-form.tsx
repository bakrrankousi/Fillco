'use client';

import { productSchema, type CategoryDto, type ProductDto } from '@fillco/contracts';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { clean, useForm, validate } from '@/lib/forms';
import { useLookups } from '@/lib/queries';
import { Button } from './ui/button';
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from './ui/form';
import { ErrorBox, Notice } from './ui/misc';

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<CategoryDto[]>('/catalog/categories'),
    staleTime: 5 * 60_000,
  });
}

export function ProductForm({
  product,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  product?: ProductDto;
  onSubmit: (body: Record<string, unknown>) => Promise<unknown>;
  onCancel?: () => void;
  submitLabel: string;
}) {
  const lookups = useLookups();
  const categories = useCategories();
  const specLocked = !!product && product.variants.length > 0;
  const f = useForm({
    code: product?.code ?? '',
    name: product?.name ?? '',
    categoryId: product?.category.id ?? '',
    description: product?.description ?? '',
    defaultSalesUom: product?.defaultSalesUom ?? 'MT',
    defaultPurchaseUom: product?.defaultPurchaseUom ?? 'MT',
    hsCode: product?.hsCode ?? '',
    countryOfOrigin: product?.countryOfOrigin ?? '',
    defaultPurchaseCurrency: product?.defaultPurchaseCurrency ?? '',
    defaultSalesCurrency: product?.defaultSalesCurrency ?? '',
    defaultPackagingTypeId: product?.defaultPackagingType?.id ?? '',
    isActive: product?.isActive ?? true,
    notes: product?.notes ?? '',
    fixedAttributes: (product?.fixedAttributes ?? {}) as Record<string, string | number | boolean>,
  });
  const v = f.values;
  const category = categories.data?.find((c) => c.id === v.categoryId);

  const submit = async () => {
    const fixed = Object.fromEntries(
      Object.entries(v.fixedAttributes).filter(([, x]) => x !== '' && x !== undefined),
    );
    const body = {
      ...clean({ ...v, fixedAttributes: undefined }),
      fixedAttributes: fixed,
      isActive: v.isActive,
    };
    const check = validate(productSchema, body);
    if (!check.ok) return f.setErrors(check.errors);
    try {
      await onSubmit(body);
    } catch (err) {
      f.fail(err);
    }
  };

  const setFixed = (code: string, value: string | number | boolean) =>
    f.set('fixedAttributes', { ...v.fixedAttributes, [code]: value });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-5"
    >
      <FormGrid>
        <Field label="Code" required error={f.errors.code} hint="e.g. PSF-HCS">
          <Input value={v.code} onChange={(e) => f.set('code', e.target.value.toUpperCase())} autoFocus />
        </Field>
        <Field label="Name" required error={f.errors.name} className="sm:col-span-2">
          <Input value={v.name} onChange={(e) => f.set('name', e.target.value)} />
        </Field>
        <Field
          label="Category"
          required
          error={f.errors.categoryId}
          hint={specLocked ? 'Locked: variants exist' : undefined}
        >
          <Select
            value={v.categoryId}
            disabled={specLocked}
            onChange={(e) => f.set('categoryId', e.target.value)}
          >
            <option value="">Select…</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.path}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="HS code" error={f.errors.hsCode}>
          <Input value={v.hsCode} onChange={(e) => f.set('hsCode', e.target.value)} />
        </Field>
        <Field label="Country of origin" error={f.errors.countryOfOrigin}>
          <Select value={v.countryOfOrigin} onChange={(e) => f.set('countryOfOrigin', e.target.value)}>
            <option value="">Varies by supplier</option>
            {lookups.data?.countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Sales unit">
          <Select value={v.defaultSalesUom} onChange={(e) => f.set('defaultSalesUom', e.target.value)}>
            {lookups.data?.uoms.map((u) => (
              <option key={u.code}>{u.code}</option>
            ))}
          </Select>
        </Field>
        <Field label="Purchase unit">
          <Select value={v.defaultPurchaseUom} onChange={(e) => f.set('defaultPurchaseUom', e.target.value)}>
            {lookups.data?.uoms.map((u) => (
              <option key={u.code}>{u.code}</option>
            ))}
          </Select>
        </Field>
        <Field label="Packaging">
          <Select
            value={v.defaultPackagingTypeId}
            onChange={(e) => f.set('defaultPackagingTypeId', e.target.value)}
          >
            <option value="">—</option>
            {lookups.data?.packagingTypes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Default sales currency">
          <Select
            value={v.defaultSalesCurrency}
            onChange={(e) => f.set('defaultSalesCurrency', e.target.value)}
          >
            <option value="">—</option>
            {lookups.data?.currencies.map((c) => (
              <option key={c.code}>{c.code}</option>
            ))}
          </Select>
        </Field>
        <Field label="Default purchase currency">
          <Select
            value={v.defaultPurchaseCurrency}
            onChange={(e) => f.set('defaultPurchaseCurrency', e.target.value)}
          >
            <option value="">—</option>
            {lookups.data?.currencies.map((c) => (
              <option key={c.code}>{c.code}</option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end pb-2">
          <Checkbox
            label="Active"
            checked={v.isActive}
            onChange={(e) => f.set('isActive', e.target.checked)}
          />
        </div>
      </FormGrid>
      <Field label="Description" error={f.errors.description}>
        <Textarea value={v.description} onChange={(e) => f.set('description', e.target.value)} rows={2} />
      </Field>

      {category && (
        <fieldset className="rounded-md border border-line p-4">
          <legend className="px-1 text-xs font-semibold tracking-wide text-muted uppercase">
            Fixed specification
          </legend>
          <p className="mb-3 text-xs text-muted">
            Values set here apply to every order of this product (e.g. HCS is always siliconized). Leave blank
            to choose per order line.
          </p>
          {specLocked && (
            <Notice tone="warning" className="mb-3">
              Variants already exist, so the fixed specification can no longer change.
            </Notice>
          )}
          <FormGrid columns={4}>
            {category.attributes.map((rule) => {
              const a = rule.attribute;
              const value = v.fixedAttributes[a.code];
              const err = f.errors[`fixedAttributes.${a.code}`];
              return (
                <Field key={a.code} label={`${a.label}${a.unit ? ` (${a.unit})` : ''}`} error={err}>
                  {a.dataType === 'ENUM' ? (
                    <Select
                      disabled={specLocked}
                      value={String(value ?? '')}
                      onChange={(e) => setFixed(a.code, e.target.value)}
                    >
                      <option value="">Varies</option>
                      {a.enumOptions?.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  ) : a.dataType === 'BOOLEAN' ? (
                    <Select
                      disabled={specLocked}
                      value={value === undefined || value === '' ? '' : String(value)}
                      onChange={(e) =>
                        setFixed(a.code, e.target.value === '' ? '' : e.target.value === 'true')
                      }
                    >
                      <option value="">Varies</option>
                      <option value="true">{a.trueLabel ?? 'Yes'}</option>
                      <option value="false">{a.falseLabel ?? 'No'}</option>
                    </Select>
                  ) : (
                    <Input
                      disabled={specLocked}
                      value={String(value ?? '')}
                      placeholder="Varies"
                      onChange={(e) =>
                        setFixed(
                          a.code,
                          a.dataType === 'NUMBER' && e.target.value !== ''
                            ? Number(e.target.value)
                            : e.target.value,
                        )
                      }
                    />
                  )}
                </Field>
              );
            })}
          </FormGrid>
        </fieldset>
      )}
      <Field label="Notes">
        <Textarea value={v.notes} onChange={(e) => f.set('notes', e.target.value)} rows={2} />
      </Field>
      <ErrorBox error={f.formError} />
      <div className="flex justify-end gap-2">
        {onCancel && <Button onClick={onCancel}>Cancel</Button>}
        <Button type="submit" variant="primary">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
