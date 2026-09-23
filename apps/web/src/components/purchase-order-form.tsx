'use client';

import { purchaseOrderSchema, type PurchaseOrderDto } from '@fillco/contracts';
import { addDaysIso, todayIso } from '@/lib/format';
import { useForm, validate } from '@/lib/forms';
import {
  CurrencySelect,
  DateField,
  IncotermSelect,
  PortSelect,
  Section,
  TermSelect,
  useSupplierOptions,
} from './document-form';
import {
  LineDraft,
  lineFromDto,
  LineItemsEditor,
  linesToInput,
  newLine,
  useProductDetails,
} from './line-items';
import { Button } from './ui/button';
import { Field, FormGrid, Input, Select, Textarea } from './ui/form';
import { ErrorBox, Notice } from './ui/misc';

export function PurchaseOrderForm({
  order,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  order?: PurchaseOrderDto;
  onSubmit: (body: Record<string, unknown>) => Promise<unknown>;
  onCancel: () => void;
  submitLabel: string;
}) {
  const suppliers = useSupplierOptions('MATERIAL');
  const today = todayIso();
  const f = useForm({
    supplierId: order?.supplier.id ?? '',
    supplierRef: order?.supplierRef ?? '',
    poDate: order?.poDate ?? today,
    currency: order?.currency ?? 'USD',
    incoterm: order?.incoterm ?? 'FOB',
    loadingPortId: order?.loadingPort?.id ?? '',
    destinationPortId: order?.destinationPort?.id ?? '',
    paymentTermId: order?.paymentTerm?.id ?? '',
    expectedReadyDate: order?.expectedReadyDate ?? addDaysIso(today, 21),
    notes: order?.notes ?? '',
    internalNotes: order?.internalNotes ?? '',
    lines: order ? order.lines.map(lineFromDto) : [newLine()],
  });
  const v = f.values;
  const products = useProductDetails(v.lines.map((l) => l.productId));
  const supplier = suppliers.data?.items.find((s) => s.id === v.supplierId);
  const lockedIds = order?.lines.filter((l) => l.allocations.length > 0).map((l) => l.id) ?? [];

  const pickSupplier = (id: string) => {
    const s = suppliers.data?.items.find((x) => x.id === id);
    if (!s || order) return f.set('supplierId', id);
    f.setValues((prev) => ({
      ...prev,
      supplierId: id,
      currency: s.defaultCurrency,
      incoterm: s.defaultIncoterm ?? prev.incoterm,
      loadingPortId: s.defaultLoadingPortId ?? '',
      paymentTermId: s.paymentTermId ?? '',
      expectedReadyDate: s.productionLeadTimeDays
        ? addDaysIso(prev.poDate, s.productionLeadTimeDays)
        : prev.expectedReadyDate,
    }));
  };

  const submit = async () => {
    const body = {
      supplierId: v.supplierId,
      supplierRef: v.supplierRef || null,
      poDate: v.poDate,
      currency: v.currency,
      incoterm: v.incoterm || null,
      loadingPortId: v.loadingPortId || null,
      destinationPortId: v.destinationPortId || null,
      paymentTermId: v.paymentTermId || null,
      expectedReadyDate: v.expectedReadyDate || null,
      notes: v.notes || null,
      internalNotes: v.internalNotes || null,
      lines: linesToInput(v.lines, products, (l: LineDraft) => ({
        expectedReadyDate: l.expectedReadyDate || null,
      })),
    };
    const check = validate(purchaseOrderSchema, body);
    if (!check.ok) return f.setErrors(check.errors);
    try {
      await onSubmit(body);
    } catch (err) {
      f.fail(err);
    }
  };

  return (
    <div className="space-y-4">
      <Section title="Purchase order">
        <FormGrid columns={4}>
          <Field label="Supplier" required error={f.errors.supplierId} className="sm:col-span-2">
            <Select value={v.supplierId} onChange={(e) => pickSupplier(e.target.value)} disabled={!!order}>
              <option value="">Select a supplier…</option>
              {suppliers.data?.items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.companyName} ({s.countryCode})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Supplier reference (PI no.)">
            <Input value={v.supplierRef} onChange={(e) => f.set('supplierRef', e.target.value)} />
          </Field>
          <DateField
            label="PO date"
            required
            value={v.poDate}
            onChange={(x) => f.set('poDate', x)}
            error={f.errors.poDate}
          />
          <CurrencySelect
            value={v.currency}
            onChange={(x) => f.set('currency', x)}
            error={f.errors.currency}
          />
          <IncotermSelect value={v.incoterm} onChange={(x) => f.set('incoterm', x)} />
          <PortSelect
            label="Loading port"
            value={v.loadingPortId}
            onChange={(x) => f.set('loadingPortId', x)}
            countryCode={supplier?.countryCode}
          />
          <DateField
            label="Expected ready date"
            value={v.expectedReadyDate}
            onChange={(x) => f.set('expectedReadyDate', x)}
          />
          <div className="sm:col-span-2">
            <TermSelect value={v.paymentTermId} onChange={(x) => f.set('paymentTermId', x)} />
          </div>
        </FormGrid>
      </Section>
      <Section title="Products">
        {lockedIds.length > 0 && (
          <Notice className="mb-3">
            Lines allocated to customer orders keep their product and specification, and cannot go below the
            allocated quantity.
          </Notice>
        )}
        <LineItemsEditor
          lines={v.lines}
          onChange={(lines) => f.set('lines', lines)}
          currency={v.currency}
          errors={f.errors}
          showReadyDate
          lockedIds={lockedIds}
        />
      </Section>
      <Section title="Notes">
        <FormGrid columns={2}>
          <Field label="Notes to supplier">
            <Textarea value={v.notes} onChange={(e) => f.set('notes', e.target.value)} />
          </Field>
          <Field label="Internal notes">
            <Textarea value={v.internalNotes} onChange={(e) => f.set('internalNotes', e.target.value)} />
          </Field>
        </FormGrid>
      </Section>
      <ErrorBox error={f.formError} />
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={() => void submit()}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
