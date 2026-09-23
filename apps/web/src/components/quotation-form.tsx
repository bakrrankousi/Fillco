'use client';

import { quotationSchema, type QuotationDto } from '@fillco/contracts';
import { useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { addDaysIso, todayIso } from '@/lib/format';
import { useForm, validate } from '@/lib/forms';
import {
  CurrencySelect,
  DateField,
  IncotermSelect,
  PortSelect,
  Section,
  TermSelect,
  useCustomerOptions,
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
import { Field, FormGrid, Select, Textarea } from './ui/form';
import { ErrorBox } from './ui/misc';

export function QuotationForm({
  quotation,
  initialCustomerId,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  quotation?: QuotationDto;
  initialCustomerId?: string;
  onSubmit: (body: Record<string, unknown>) => Promise<unknown>;
  onCancel: () => void;
  submitLabel: string;
}) {
  const { can } = useAuth();
  const customers = useCustomerOptions();
  const today = todayIso();
  const f = useForm({
    customerId: quotation?.customer.id ?? initialCustomerId ?? '',
    quotationDate: quotation?.quotationDate ?? today,
    validUntil: quotation?.validUntil ?? addDaysIso(today, 14),
    currency: quotation?.currency ?? 'USD',
    incoterm: quotation?.incoterm ?? '',
    loadingPortId: quotation?.loadingPort?.id ?? '',
    destinationCountry: quotation?.destinationCountry ?? '',
    destinationPortId: quotation?.destinationPort?.id ?? '',
    paymentTermId: quotation?.paymentTerm?.id ?? '',
    estimatedShipmentDate: quotation?.estimatedShipmentDate ?? '',
    notes: quotation?.notes ?? '',
    internalNotes: quotation?.internalNotes ?? '',
    lines: quotation ? quotation.lines.map(lineFromDto) : [newLine()],
  });
  const v = f.values;
  const products = useProductDetails(v.lines.map((l) => l.productId));
  const showCost = can('finance.view_costs');

  const pickCustomer = (id: string) => {
    f.set('customerId', id);
    const c = customers.data?.items.find((x) => x.id === id);
    if (!c || quotation) return;
    f.setValues((prev) => ({
      ...prev,
      customerId: id,
      currency: c.defaultCurrency,
      destinationCountry: c.countryCode,
      incoterm: c.defaultIncoterm ?? prev.incoterm,
      destinationPortId: c.defaultDestinationPortId ?? prev.destinationPortId,
      paymentTermId: c.paymentTermId ?? prev.paymentTermId,
    }));
  };

  // Prefill from the customer passed in the URL (e.g. "New quotation" on a customer page).
  const prefilled = useRef(false);
  useEffect(() => {
    if (!prefilled.current && initialCustomerId && !quotation && customers.data) {
      prefilled.current = true;
      pickCustomer(initialCustomerId);
    }
  });

  const submit = async () => {
    const body = {
      customerId: v.customerId,
      quotationDate: v.quotationDate,
      validUntil: v.validUntil,
      currency: v.currency,
      incoterm: v.incoterm || null,
      loadingPortId: v.loadingPortId || null,
      destinationCountry: v.destinationCountry || null,
      destinationPortId: v.destinationPortId || null,
      paymentTermId: v.paymentTermId || null,
      estimatedShipmentDate: v.estimatedShipmentDate || null,
      notes: v.notes || null,
      internalNotes: v.internalNotes || null,
      lines: linesToInput(v.lines, products, (l: LineDraft) =>
        showCost ? { estUnitCost: l.estUnitCost || null } : {},
      ),
    };
    const check = validate(quotationSchema, body);
    if (!check.ok) return f.setErrors(check.errors);
    try {
      await onSubmit(body);
    } catch (err) {
      f.fail(err);
    }
  };

  return (
    <div className="space-y-4">
      <Section title="Offer">
        <FormGrid columns={4}>
          <Field label="Customer" required error={f.errors.customerId} className="sm:col-span-2">
            <Select
              value={v.customerId}
              onChange={(e) => pickCustomer(e.target.value)}
              disabled={!!quotation}
            >
              <option value="">Select a customer…</option>
              {customers.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.companyName} ({c.countryCode})
                </option>
              ))}
            </Select>
          </Field>
          <DateField
            label="Quotation date"
            required
            value={v.quotationDate}
            onChange={(x) => f.set('quotationDate', x)}
            error={f.errors.quotationDate}
          />
          <DateField
            label="Valid until"
            required
            value={v.validUntil}
            onChange={(x) => f.set('validUntil', x)}
            error={f.errors.validUntil}
          />
          <CurrencySelect
            value={v.currency}
            onChange={(x) => f.set('currency', x)}
            error={f.errors.currency}
          />
          <IncotermSelect value={v.incoterm} onChange={(x) => f.set('incoterm', x)} />
          <PortSelect
            label="Destination port"
            value={v.destinationPortId}
            onChange={(x) => f.set('destinationPortId', x)}
            countryCode={v.destinationCountry || undefined}
          />
          <DateField
            label="Estimated shipment"
            value={v.estimatedShipmentDate}
            onChange={(x) => f.set('estimatedShipmentDate', x)}
          />
          <div className="sm:col-span-2">
            <TermSelect value={v.paymentTermId} onChange={(x) => f.set('paymentTermId', x)} />
          </div>
        </FormGrid>
      </Section>
      <Section title="Products">
        <LineItemsEditor
          lines={v.lines}
          onChange={(lines) => f.set('lines', lines)}
          currency={v.currency}
          errors={f.errors}
          showCost={showCost}
        />
        {f.errors.lines && <p className="mt-2 text-sm text-red-700">{f.errors.lines[0]}</p>}
      </Section>
      <Section title="Notes">
        <FormGrid columns={2}>
          <Field label="Notes for the customer">
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
