'use client';

import { salesOrderSchema, type CustomerDto, type SalesOrderDto } from '@fillco/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { addDaysIso, humanize, todayIso } from '@/lib/format';
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
import { Field, FormGrid, Input, Select, Textarea } from './ui/form';
import { ErrorBox, Notice } from './ui/misc';

export function SalesOrderForm({
  order,
  initialCustomerId,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  order?: SalesOrderDto;
  initialCustomerId?: string;
  onSubmit: (body: Record<string, unknown>) => Promise<unknown>;
  onCancel: () => void;
  submitLabel: string;
}) {
  const customers = useCustomerOptions();
  const today = todayIso();
  const f = useForm({
    customerId: order?.customer.id ?? initialCustomerId ?? '',
    customerPoRef: order?.customerPoRef ?? '',
    orderDate: order?.orderDate ?? today,
    currency: order?.currency ?? 'USD',
    incoterm: order?.incoterm ?? '',
    loadingPortId: order?.loadingPort?.id ?? '',
    destinationCountry: order?.destinationCountry ?? '',
    destinationPortId: order?.destinationPort?.id ?? '',
    shippingAddressId: order?.shippingAddress?.id ?? '',
    billingAddressId: order?.billingAddress?.id ?? '',
    paymentTermId: order?.paymentTerm?.id ?? '',
    requestedShipmentDate: order?.requestedShipmentDate ?? addDaysIso(today, 30),
    notes: order?.notes ?? '',
    internalNotes: order?.internalNotes ?? '',
    lines: order ? order.lines.map(lineFromDto) : [newLine()],
  });
  const v = f.values;
  const products = useProductDetails(v.lines.map((l) => l.productId));
  const customer = useQuery({
    queryKey: ['customer', v.customerId],
    queryFn: () => api.get<CustomerDto>(`/customers/${v.customerId}`),
    enabled: !!v.customerId,
  });
  const addresses = customer.data?.addresses ?? [];

  const pickCustomer = (id: string) => {
    const c = customers.data?.items.find((x) => x.id === id);
    if (!c || order) return f.set('customerId', id);
    f.setValues((prev) => ({
      ...prev,
      customerId: id,
      currency: c.defaultCurrency,
      destinationCountry: c.countryCode,
      incoterm: c.defaultIncoterm ?? prev.incoterm,
      destinationPortId: c.defaultDestinationPortId ?? '',
      paymentTermId: c.paymentTermId ?? '',
      shippingAddressId: '',
      billingAddressId: '',
    }));
  };
  const prefilled = useRef(false);
  useEffect(() => {
    if (!prefilled.current && initialCustomerId && !order && customers.data) {
      prefilled.current = true;
      pickCustomer(initialCustomerId);
    }
  });
  // Default addresses once the customer's detail is loaded.
  useEffect(() => {
    if (!customer.data || order) return;
    f.setValues((prev) => ({
      ...prev,
      shippingAddressId:
        prev.shippingAddressId || (addresses.find((a) => a.type === 'SHIPPING' && a.isDefault)?.id ?? ''),
      billingAddressId:
        prev.billingAddressId || (addresses.find((a) => a.type === 'BILLING' && a.isDefault)?.id ?? ''),
    }));
  }, [customer.data]);

  const submit = async () => {
    const body = {
      customerId: v.customerId,
      customerPoRef: v.customerPoRef || null,
      orderDate: v.orderDate,
      currency: v.currency,
      incoterm: v.incoterm || null,
      loadingPortId: v.loadingPortId || null,
      destinationCountry: v.destinationCountry || null,
      destinationPortId: v.destinationPortId || null,
      shippingAddressId: v.shippingAddressId || null,
      billingAddressId: v.billingAddressId || null,
      paymentTermId: v.paymentTermId || null,
      requestedShipmentDate: v.requestedShipmentDate || null,
      notes: v.notes || null,
      internalNotes: v.internalNotes || null,
      lines: linesToInput(v.lines, products, (l: LineDraft) =>
        l.tolerancePct ? { tolerancePct: l.tolerancePct } : {},
      ),
    };
    const check = validate(salesOrderSchema, body);
    if (!check.ok) return f.setErrors(check.errors);
    try {
      await onSubmit(body);
    } catch (err) {
      f.fail(err);
    }
  };

  const status = customer.data?.status;
  return (
    <div className="space-y-4">
      <Section title="Order">
        <FormGrid columns={4}>
          <Field label="Customer" required error={f.errors.customerId} className="sm:col-span-2">
            <Select value={v.customerId} onChange={(e) => pickCustomer(e.target.value)} disabled={!!order}>
              <option value="">Select a customer…</option>
              {customers.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.companyName} ({c.countryCode})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Customer PO reference" error={f.errors.customerPoRef}>
            <Input value={v.customerPoRef} onChange={(e) => f.set('customerPoRef', e.target.value)} />
          </Field>
          <DateField
            label="Order date"
            required
            value={v.orderDate}
            onChange={(x) => f.set('orderDate', x)}
            error={f.errors.orderDate}
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
            label="Requested shipment"
            value={v.requestedShipmentDate}
            onChange={(x) => f.set('requestedShipmentDate', x)}
          />
          <div className="sm:col-span-2">
            <TermSelect value={v.paymentTermId} onChange={(x) => f.set('paymentTermId', x)} />
          </div>
          <Field label="Shipping address">
            <Select value={v.shippingAddressId} onChange={(e) => f.set('shippingAddressId', e.target.value)}>
              <option value="">—</option>
              {addresses
                .filter((a) => a.type !== 'BILLING')
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label ?? humanize(a.type)}: {a.line1}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Billing address">
            <Select value={v.billingAddressId} onChange={(e) => f.set('billingAddressId', e.target.value)}>
              <option value="">—</option>
              {addresses
                .filter((a) => a.type === 'BILLING')
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label ?? humanize(a.type)}: {a.line1}
                  </option>
                ))}
            </Select>
          </Field>
        </FormGrid>
        {(status === 'ON_HOLD' || status === 'BLOCKED') && (
          <Notice tone="warning" className="mt-3">
            This customer is {humanize(status).toLowerCase()}. The order can be saved, but confirmation needs
            management approval.
          </Notice>
        )}
      </Section>
      <Section title="Products">
        <LineItemsEditor
          lines={v.lines}
          onChange={(lines) => f.set('lines', lines)}
          currency={v.currency}
          errors={f.errors}
          showTolerance
        />
        {f.errors.lines && <p className="mt-2 text-sm text-red-700">{f.errors.lines[0]}</p>}
      </Section>
      <Section title="Notes">
        <FormGrid columns={2}>
          <Field label="Notes (on order confirmation)">
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
