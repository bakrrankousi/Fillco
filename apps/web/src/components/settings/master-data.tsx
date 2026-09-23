'use client';

import {
  attributeDefinitionSchema,
  exchangeRateSchema,
  paymentTermSchema,
  portSchema,
  type AttributeDefinitionDto,
  type ExchangeRateDto,
  type PaymentTermDto,
  type PortDto,
} from '@fillco/contracts';
import {
  ATTRIBUTE_DATA_TYPES,
  describeInstallments,
  PAYMENT_INSTRUMENTS,
  TRIGGER_EVENTS,
  TRIGGER_EVENT_LABELS,
  TriggerEvent,
} from '@fillco/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCategories } from '@/components/product-form';
import { useToast } from '@/components/toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, FormGrid, Input, Select } from '@/components/ui/form';
import { ErrorBox, Loading } from '@/components/ui/misc';
import { DataTable } from '@/components/ui/table';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { clean, useForm, validate } from '@/lib/forms';
import { date, humanize, todayIso } from '@/lib/format';
import { useLookups } from '@/lib/queries';

// ───────────── Exchange rates ─────────────

export function ExchangeRatesSettings() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const lookups = useLookups();
  const [currency, setCurrency] = useState('');
  const rates = useQuery({
    queryKey: ['rates', currency],
    queryFn: () => api.get<ExchangeRateDto[]>('/exchange-rates', { currency: currency || undefined }),
  });
  const base = lookups.data?.baseCurrency ?? 'USD';
  const f = useForm({ rateDate: todayIso(), fromCurrency: 'EUR', toCurrency: base, rate: '' });
  const save = async () => {
    const check = validate(exchangeRateSchema, f.values);
    if (!check.ok) return f.setErrors(check.errors);
    try {
      await api.post('/exchange-rates', f.values);
      await qc.invalidateQueries({ queryKey: ['rates'] });
      toast.success('Rate saved');
      f.set('rate', '');
    } catch (err) {
      f.fail(err);
    }
  };
  return (
    <Card>
      <CardHeader
        title="Exchange rates"
        subtitle={`Stored as units of the second currency per 1 unit of the first. Documents use the latest rate on or before their date and keep it forever.`}
      />
      {can('exchange_rate.manage') && (
        <CardBody className="border-b border-line">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Date" error={f.errors.rateDate}>
              <Input
                type="date"
                value={f.values.rateDate}
                onChange={(e) => f.set('rateDate', e.target.value)}
                className="w-40"
              />
            </Field>
            <Field label="1 unit of">
              <Select
                value={f.values.fromCurrency}
                onChange={(e) => f.set('fromCurrency', e.target.value)}
                className="w-24"
              >
                {lookups.data?.currencies.map((c) => (
                  <option key={c.code}>{c.code}</option>
                ))}
              </Select>
            </Field>
            <Field label="equals" error={f.errors.rate}>
              <Input
                inputMode="decimal"
                value={f.values.rate}
                onChange={(e) => f.set('rate', e.target.value)}
                className="w-36"
                placeholder="1.0850"
              />
            </Field>
            <Field label="of" error={f.errors.toCurrency}>
              <Select
                value={f.values.toCurrency}
                onChange={(e) => f.set('toCurrency', e.target.value)}
                className="w-24"
              >
                {lookups.data?.currencies.map((c) => (
                  <option key={c.code}>{c.code}</option>
                ))}
              </Select>
            </Field>
            <Button variant="primary" onClick={() => void save()}>
              Save rate
            </Button>
          </div>
          <ErrorBox error={f.formError} className="mt-2" />
        </CardBody>
      )}
      <div className="flex items-center gap-2 px-4 py-2">
        <Select
          aria-label="Filter currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className="w-40"
        >
          <option value="">All currencies</option>
          {lookups.data?.currencies.map((c) => (
            <option key={c.code}>{c.code}</option>
          ))}
        </Select>
      </div>
      {!rates.data ? (
        <Loading />
      ) : (
        <DataTable
          dense
          rows={rates.data}
          rowKey={(r) => r.id}
          empty="No rates entered."
          columns={[
            { key: 'd', header: 'Date', cell: (r) => date(r.rateDate) },
            { key: 'p', header: 'Pair', cell: (r) => `1 ${r.fromCurrency} =` },
            { key: 'r', header: 'Rate', align: 'right', cell: (r) => `${r.rate} ${r.toCurrency}` },
            { key: 's', header: 'Source', cell: (r) => <Badge>{r.source}</Badge> },
          ]}
        />
      )}
    </Card>
  );
}

// ───────────── Payment terms ─────────────

type InstallmentDraft = {
  percent: string;
  triggerEvent: TriggerEvent;
  offsetDays: string;
  instrument: string;
};

function TermDialog({
  term,
  open,
  onClose,
}: {
  term: PaymentTermDto | null;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const init = () => ({
    code: term?.code ?? '',
    name: term?.name ?? '',
    description: term?.description ?? '',
    isActive: term?.isActive ?? true,
    installments: (term?.installments.map((i) => ({
      percent: i.percent,
      triggerEvent: i.triggerEvent,
      offsetDays: String(i.offsetDays),
      instrument: i.instrument ?? '',
    })) ?? [
      { percent: '100', triggerEvent: 'INVOICE_DATE', offsetDays: '30', instrument: 'TT' },
    ]) as InstallmentDraft[],
  });
  const f = useForm(init());
  useEffect(() => {
    if (open) f.reset(init());
  }, [open, term]);
  const v = f.values;
  const parsed = v.installments.map((i) => ({
    percent: i.percent,
    triggerEvent: i.triggerEvent,
    offsetDays: Number(i.offsetDays) || 0,
    instrument: (i.instrument || null) as never,
  }));
  const totalPct = v.installments.reduce((a, i) => a + Number(i.percent || 0), 0);
  const setInst = (idx: number, patch: Partial<InstallmentDraft>) =>
    f.set(
      'installments',
      v.installments.map((x, j) => (j === idx ? { ...x, ...patch } : x)),
    );
  const save = async () => {
    const body = {
      ...clean({ code: v.code, name: v.name, description: v.description }),
      isActive: v.isActive,
      installments: parsed,
    };
    const check = validate(paymentTermSchema, body);
    if (!check.ok) return f.setErrors(check.errors);
    try {
      if (term) await api.put(`/payment-terms/${term.id}`, { ...body, version: term.version });
      else await api.post('/payment-terms', body);
      await qc.invalidateQueries({ queryKey: ['payment-terms'] });
      await qc.invalidateQueries({ queryKey: ['lookups'] });
      toast.success('Payment term saved');
      onClose();
    } catch (err) {
      f.fail(err);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={term ? `Edit ${term.name}` : 'New payment term'}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <FormGrid>
        <Field label="Code" required error={f.errors.code}>
          <Input value={v.code} onChange={(e) => f.set('code', e.target.value.toUpperCase())} />
        </Field>
        <Field label="Name" required error={f.errors.name} className="sm:col-span-2">
          <Input
            value={v.name}
            onChange={(e) => f.set('name', e.target.value)}
            placeholder="30% advance, 70% against BL"
          />
        </Field>
      </FormGrid>
      <div className="mt-4 space-y-2">
        {v.installments.map((i, idx) => (
          <div key={idx} className="flex flex-wrap items-end gap-2">
            <Field label="%">
              <Input
                inputMode="decimal"
                value={i.percent}
                onChange={(e) => setInst(idx, { percent: e.target.value })}
                className="w-20"
              />
            </Field>
            <Field label="Days">
              <Input
                inputMode="numeric"
                value={i.offsetDays}
                onChange={(e) => setInst(idx, { offsetDays: e.target.value })}
                className="w-20"
              />
            </Field>
            <Field label="After event">
              <Select
                value={i.triggerEvent}
                onChange={(e) => setInst(idx, { triggerEvent: e.target.value as TriggerEvent })}
                className="w-48"
              >
                {TRIGGER_EVENTS.map((t) => (
                  <option key={t} value={t}>
                    {TRIGGER_EVENT_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Instrument">
              <Select
                value={i.instrument}
                onChange={(e) => setInst(idx, { instrument: e.target.value })}
                className="w-28"
              >
                <option value="">—</option>
                {PAYMENT_INSTRUMENTS.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </Select>
            </Field>
            <Button
              variant="ghost"
              aria-label="Remove installment"
              disabled={v.installments.length === 1}
              onClick={() =>
                f.set(
                  'installments',
                  v.installments.filter((_, j) => j !== idx),
                )
              }
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          onClick={() =>
            f.set('installments', [
              ...v.installments,
              {
                percent: String(Math.max(0, 100 - totalPct)),
                triggerEvent: 'BL_DATE',
                offsetDays: '0',
                instrument: 'TT',
              },
            ])
          }
        >
          <Plus className="h-4 w-4" /> Add installment
        </Button>
      </div>
      <p className={`mt-3 text-sm ${totalPct === 100 ? 'text-slate-700' : 'text-red-700'}`}>
        {totalPct === 100
          ? `Reads as: ${describeInstallments(parsed)}`
          : `Installments add up to ${totalPct}% — they must total 100%.`}
      </p>
      <Checkbox
        className="mt-3"
        label="Active"
        checked={v.isActive}
        onChange={(e) => f.set('isActive', e.target.checked)}
      />
      <ErrorBox error={f.formError} className="mt-3" />
    </Dialog>
  );
}

export function PaymentTermsSettings() {
  const { can } = useAuth();
  const terms = useQuery({
    queryKey: ['payment-terms'],
    queryFn: () => api.get<PaymentTermDto[]>('/payment-terms'),
  });
  const [editing, setEditing] = useState<PaymentTermDto | null | 'new'>(null);
  const manage = can('master_data.manage');
  return (
    <Card>
      <CardHeader
        title="Payment terms"
        subtitle="Event-based installments. Confirmed orders keep a snapshot, so editing a term never changes existing orders."
        actions={
          manage && (
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" /> New term
            </Button>
          )
        }
      />
      {!terms.data ? (
        <Loading />
      ) : (
        <DataTable
          rows={terms.data}
          rowKey={(t) => t.id}
          columns={[
            { key: 'c', header: 'Code', cell: (t) => <span className="font-mono text-xs">{t.code}</span> },
            {
              key: 'n',
              header: 'Name',
              cell: (t) =>
                manage ? (
                  <button
                    className="font-medium text-brand-700 hover:underline"
                    onClick={() => setEditing(t)}
                  >
                    {t.name}
                  </button>
                ) : (
                  t.name
                ),
            },
            {
              key: 's',
              header: 'Schedule',
              cell: (t) => <span className="text-slate-600">{t.summary}</span>,
            },
            {
              key: 'a',
              header: 'Status',
              cell: (t) =>
                t.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="muted">Inactive</Badge>,
            },
          ]}
        />
      )}
      <TermDialog
        term={editing === 'new' ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
    </Card>
  );
}

// ───────────── Ports ─────────────

export function PortsSettings() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const lookups = useLookups();
  const ports = useQuery({ queryKey: ['ports'], queryFn: () => api.get<PortDto[]>('/ports') });
  const f = useForm({ locode: '', name: '', countryCode: '', type: 'SEA' as PortDto['type'] });
  const add = async () => {
    const check = validate(portSchema, f.values);
    if (!check.ok) return f.setErrors(check.errors);
    try {
      await api.post('/ports', f.values);
      await qc.invalidateQueries({ queryKey: ['ports'] });
      await qc.invalidateQueries({ queryKey: ['lookups'] });
      f.reset({ locode: '', name: '', countryCode: '', type: 'SEA' });
      toast.success('Port added');
    } catch (err) {
      f.fail(err);
    }
  };
  const countries = new Map(lookups.data?.countries.map((c) => [c.code, c.name]));
  return (
    <Card>
      <CardHeader
        title="Ports & places"
        subtitle="UN/LOCODE, e.g. TRMER Mersin, CNSHA Shanghai, EGALY Alexandria"
      />
      {can('master_data.manage') && (
        <CardBody className="border-b border-line">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="LOCODE" error={f.errors.locode}>
              <Input
                value={f.values.locode}
                onChange={(e) => f.set('locode', e.target.value.toUpperCase())}
                className="w-28"
              />
            </Field>
            <Field label="Name" error={f.errors.name}>
              <Input value={f.values.name} onChange={(e) => f.set('name', e.target.value)} className="w-48" />
            </Field>
            <Field label="Country" error={f.errors.countryCode}>
              <Select
                value={f.values.countryCode}
                onChange={(e) => f.set('countryCode', e.target.value)}
                className="w-48"
              >
                <option value="">Select…</option>
                {lookups.data?.countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Type">
              <Select
                value={f.values.type}
                onChange={(e) => f.set('type', e.target.value as PortDto['type'])}
                className="w-28"
              >
                {['SEA', 'AIR', 'LAND', 'INLAND'].map((t) => (
                  <option key={t} value={t}>
                    {humanize(t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Button variant="primary" onClick={() => void add()}>
              Add port
            </Button>
          </div>
          <ErrorBox error={f.formError} className="mt-2" />
        </CardBody>
      )}
      {!ports.data ? (
        <Loading />
      ) : (
        <DataTable
          dense
          rows={ports.data}
          rowKey={(p) => p.id}
          columns={[
            {
              key: 'l',
              header: 'LOCODE',
              cell: (p) => <span className="font-mono text-xs">{p.locode}</span>,
            },
            { key: 'n', header: 'Name', cell: (p) => p.name },
            { key: 'c', header: 'Country', cell: (p) => countries.get(p.countryCode) ?? p.countryCode },
            { key: 't', header: 'Type', cell: (p) => humanize(p.type) },
          ]}
        />
      )}
    </Card>
  );
}

// ───────────── Product attributes & categories ─────────────

function AttributeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const f = useForm({
    code: '',
    label: '',
    dataType: 'NUMBER' as (typeof ATTRIBUTE_DATA_TYPES)[number],
    unit: '',
    options: '',
    trueLabel: '',
    falseLabel: '',
  });
  useEffect(() => {
    if (open)
      f.reset({
        code: '',
        label: '',
        dataType: 'NUMBER',
        unit: '',
        options: '',
        trueLabel: '',
        falseLabel: '',
      });
  }, [open]);
  const v = f.values;
  const save = async () => {
    const body = {
      code: v.code,
      label: v.label,
      dataType: v.dataType,
      unit: v.unit || null,
      enumOptions:
        v.dataType === 'ENUM'
          ? v.options
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
              .map((label) => ({ value: label.toUpperCase().replace(/[^A-Z0-9]+/g, '_'), label }))
          : null,
      trueLabel: v.dataType === 'BOOLEAN' ? v.trueLabel || null : null,
      falseLabel: v.dataType === 'BOOLEAN' ? v.falseLabel || null : null,
    };
    const check = validate(attributeDefinitionSchema, body);
    if (!check.ok) return f.setErrors(check.errors);
    try {
      await api.post('/catalog/attributes', body);
      await qc.invalidateQueries({ queryKey: ['attributes'] });
      toast.success('Attribute created — add it to a category to use it');
      onClose();
    } catch (err) {
      f.fail(err);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New specification attribute"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()}>
            Create
          </Button>
        </>
      }
    >
      <FormGrid columns={2}>
        <Field label="Code" required error={f.errors.code} hint="lower_snake_case, e.g. tenacity">
          <Input value={v.code} onChange={(e) => f.set('code', e.target.value.toLowerCase())} />
        </Field>
        <Field label="Label" required error={f.errors.label}>
          <Input value={v.label} onChange={(e) => f.set('label', e.target.value)} />
        </Field>
        <Field label="Type">
          <Select value={v.dataType} onChange={(e) => f.set('dataType', e.target.value as typeof v.dataType)}>
            {ATTRIBUTE_DATA_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </Select>
        </Field>
        {v.dataType === 'NUMBER' && (
          <Field label="Unit suffix" hint="e.g. D, mm, %, °C">
            <Input value={v.unit} onChange={(e) => f.set('unit', e.target.value)} />
          </Field>
        )}
        {v.dataType === 'ENUM' && (
          <Field
            label="Options"
            required
            error={f.errors.enumOptions}
            hint="Comma separated"
            className="sm:col-span-2"
          >
            <Input
              value={v.options}
              onChange={(e) => f.set('options', e.target.value)}
              placeholder="Raw White, Optical White, Black"
            />
          </Field>
        )}
        {v.dataType === 'BOOLEAN' && (
          <>
            <Field label="Label when yes">
              <Input value={v.trueLabel} onChange={(e) => f.set('trueLabel', e.target.value)} />
            </Field>
            <Field label="Label when no">
              <Input value={v.falseLabel} onChange={(e) => f.set('falseLabel', e.target.value)} />
            </Field>
          </>
        )}
      </FormGrid>
      <ErrorBox error={f.formError} className="mt-3" />
    </Dialog>
  );
}

export function CatalogSettings() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const categories = useCategories();
  const attributes = useQuery({
    queryKey: ['attributes'],
    queryFn: () => api.get<AttributeDefinitionDto[]>('/catalog/attributes'),
  });
  const [adding, setAdding] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const manage = can('catalog.manage');
  const category = categories.data?.find((c) => c.id === categoryId) ?? categories.data?.[0];
  const own = category?.attributes.filter((a) => !a.inheritedFrom) ?? [];

  const setRules = async (
    rules: { attributeId: string; isRequired: boolean; isVariantDefining: boolean; sortOrder: number }[],
  ) => {
    try {
      qc.setQueryData(
        ['categories'],
        await api.put(`/catalog/categories/${category!.id}/attributes`, { attributes: rules }),
      );
      toast.success('Category specification updated');
    } catch (err) {
      toast.error(err);
    }
  };
  const ownRules = own.map((a) => ({
    attributeId: a.attribute.id,
    isRequired: a.isRequired,
    isVariantDefining: a.isVariantDefining,
    sortOrder: a.sortOrder,
  }));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Category specifications"
          subtitle="Which fields each product category asks for. Children inherit their parents' fields."
        />
        <CardBody>
          <Select
            aria-label="Category"
            value={category?.id ?? ''}
            onChange={(e) => setCategoryId(e.target.value)}
            className="mb-3"
          >
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.path} ({c.productCount} products)
              </option>
            ))}
          </Select>
          {category && (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted uppercase">
                <tr>
                  <th className="py-1">Attribute</th>
                  <th className="py-1 text-center">Required</th>
                  <th className="py-1 text-center">Defines variant</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {category.attributes.map((a) => (
                  <tr key={a.attribute.id} className="border-t border-line">
                    <td className="py-1.5">
                      {a.attribute.label}
                      {a.inheritedFrom && (
                        <span className="ml-1 text-xs text-muted">from {a.inheritedFrom}</span>
                      )}
                    </td>
                    <td className="py-1.5 text-center">
                      <input
                        type="checkbox"
                        aria-label={`${a.attribute.label} required`}
                        checked={a.isRequired}
                        disabled={!manage || !!a.inheritedFrom}
                        onChange={(e) =>
                          void setRules(
                            ownRules.map((r) =>
                              r.attributeId === a.attribute.id ? { ...r, isRequired: e.target.checked } : r,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="py-1.5 text-center">
                      <input
                        type="checkbox"
                        aria-label={`${a.attribute.label} defines variant`}
                        checked={a.isVariantDefining}
                        disabled={!manage || !!a.inheritedFrom}
                        onChange={(e) =>
                          void setRules(
                            ownRules.map((r) =>
                              r.attributeId === a.attribute.id
                                ? { ...r, isVariantDefining: e.target.checked }
                                : r,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="py-1.5 text-right">
                      {manage && !a.inheritedFrom && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Remove ${a.attribute.label}`}
                          onClick={() =>
                            void setRules(ownRules.filter((r) => r.attributeId !== a.attribute.id))
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {manage && category && (
            <div className="mt-3 flex items-center gap-2">
              <Select
                aria-label="Add attribute to category"
                value=""
                onChange={(e) =>
                  e.target.value &&
                  void setRules([
                    ...ownRules,
                    {
                      attributeId: e.target.value,
                      isRequired: false,
                      isVariantDefining: true,
                      sortOrder: (Math.max(0, ...category.attributes.map((a) => a.sortOrder)) || 0) + 10,
                    },
                  ])
                }
              >
                <option value="">Add an attribute to {category.name}…</option>
                {attributes.data
                  ?.filter((a) => !category.attributes.some((x) => x.attribute.id === a.id))
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
              </Select>
            </div>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Specification attributes"
          actions={
            manage && (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> New attribute
              </Button>
            )
          }
        />
        {!attributes.data ? (
          <Loading />
        ) : (
          <DataTable
            dense
            rows={attributes.data}
            rowKey={(a) => a.id}
            columns={[
              { key: 'l', header: 'Label', cell: (a) => a.label },
              { key: 'c', header: 'Code', cell: (a) => <span className="font-mono text-xs">{a.code}</span> },
              { key: 't', header: 'Type', cell: (a) => humanize(a.dataType) },
              {
                key: 'o',
                header: 'Values',
                cell: (a) => (
                  <span className="text-xs text-muted">
                    {a.dataType === 'ENUM'
                      ? a.enumOptions?.map((o) => o.label).join(', ')
                      : a.dataType === 'BOOLEAN'
                        ? `${a.trueLabel ?? 'Yes'} / ${a.falseLabel ?? 'No'}`
                        : (a.unit ?? '')}
                  </span>
                ),
              },
            ]}
          />
        )}
      </Card>
      <AttributeDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
