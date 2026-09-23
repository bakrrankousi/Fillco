'use client';

import {
  addressSchema,
  contactSchema,
  createCustomerSchema,
  createSupplierSchema,
  type AddressDto,
  type ContactDto,
  type CustomerDto,
  type SupplierDto,
} from '@fillco/contracts';
import { ADDRESS_TYPES, CUSTOMER_STATUSES, SUPPLIER_STATUSES, SUPPLIER_TYPES } from '@fillco/domain';
import { ReactNode, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { clean, useForm, validate } from '@/lib/forms';
import { humanize } from '@/lib/format';
import { useLookups } from '@/lib/queries';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from './ui/form';
import { ErrorBox } from './ui/misc';

function CommonSelects({
  values,
  set,
  errors,
  children,
}: {
  values: Record<string, string>;
  set: (k: string, v: string) => void;
  errors: Record<string, string[]>;
  children?: ReactNode;
}) {
  const lookups = useLookups();
  const l = lookups.data;
  return (
    <>
      <Field label="Country" required error={errors.countryCode}>
        <Select value={values.countryCode} onChange={(e) => set('countryCode', e.target.value)}>
          <option value="">Select…</option>
          {l?.countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="City" error={errors.city}>
        <Input value={values.city} onChange={(e) => set('city', e.target.value)} />
      </Field>
      <Field label="Default currency" required error={errors.defaultCurrency}>
        <Select value={values.defaultCurrency} onChange={(e) => set('defaultCurrency', e.target.value)}>
          {l?.currencies
            .filter((c) => c.isActive)
            .map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
        </Select>
      </Field>
      <Field label="Payment terms" error={errors.paymentTermId}>
        <Select value={values.paymentTermId} onChange={(e) => set('paymentTermId', e.target.value)}>
          <option value="">—</option>
          {l?.paymentTerms
            .filter((t) => t.isActive)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </Select>
      </Field>
      <Field label="Default Incoterm" error={errors.defaultIncoterm}>
        <Select value={values.defaultIncoterm} onChange={(e) => set('defaultIncoterm', e.target.value)}>
          <option value="">—</option>
          {l?.incoterms.map((i) => (
            <option key={i.code} value={i.code}>
              {i.code} — {i.name}
            </option>
          ))}
        </Select>
      </Field>
      {children}
      <Field label="Address" error={errors.address} className="sm:col-span-2">
        <Input value={values.address} onChange={(e) => set('address', e.target.value)} />
      </Field>
      <Field label="Phone" error={errors.phone}>
        <Input value={values.phone} onChange={(e) => set('phone', e.target.value)} />
      </Field>
      <Field label="E-mail" error={errors.email}>
        <Input type="email" value={values.email} onChange={(e) => set('email', e.target.value)} />
      </Field>
      <Field label="WhatsApp" error={errors.whatsapp}>
        <Input value={values.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} />
      </Field>
      <Field label="Website" error={errors.website}>
        <Input value={values.website} onChange={(e) => set('website', e.target.value)} />
      </Field>
      <Field label="Tax ID" error={errors.taxId}>
        <Input value={values.taxId} onChange={(e) => set('taxId', e.target.value)} />
      </Field>
    </>
  );
}

const s = (v: string | null | undefined) => v ?? '';

export function customerInitial(c?: CustomerDto) {
  return {
    companyName: s(c?.companyName),
    legalName: s(c?.legalName),
    countryCode: s(c?.countryCode),
    city: s(c?.city),
    address: s(c?.address),
    phone: s(c?.phone),
    email: s(c?.email),
    whatsapp: s(c?.whatsapp),
    website: s(c?.website),
    taxId: s(c?.taxId),
    vatNumber: s(c?.vatNumber),
    defaultCurrency: c?.defaultCurrency ?? 'USD',
    paymentTermId: s(c?.paymentTerm?.id),
    creditLimit: c ? c.creditLimit : '0',
    creditLimitCurrency: c?.creditLimitCurrency ?? '',
    defaultIncoterm: s(c?.defaultIncoterm),
    defaultDestinationPortId: s(c?.defaultDestinationPort?.id),
    salespersonId: s(c?.salesperson?.id),
    status: c?.status ?? 'ACTIVE',
    notes: s(c?.notes),
  };
}

/** Create or edit a customer. Credit fields are only editable with customer.credit_limit.edit. */
export function CustomerForm({
  customer,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  customer?: CustomerDto;
  onSubmit: (body: Record<string, unknown>) => Promise<unknown>;
  onCancel?: () => void;
  submitLabel: string;
}) {
  const { can } = useAuth();
  const lookups = useLookups();
  const f = useForm(customerInitial(customer));
  const v = f.values;
  const canCredit = can('customer.credit_limit.edit');
  const canAssign = can('customer.view_all');
  const set = (k: string, val: string) => f.set(k as keyof typeof v, val);
  const destPorts =
    lookups.data?.ports.filter((p) => !v.countryCode || p.countryCode === v.countryCode) ?? [];
  const statuses = CUSTOMER_STATUSES.filter(
    (st) =>
      st === v.status ||
      st === 'ACTIVE' ||
      st === 'PROSPECT' ||
      (canCredit && (st === 'ON_HOLD' || st === 'BLOCKED')) ||
      (st === 'INACTIVE' && can('customer.archive')),
  );

  const submit = async () => {
    const body = clean({
      ...v,
      creditLimitCurrency: v.creditLimitCurrency || v.defaultCurrency,
      contacts: [],
      addresses: [],
    });
    const check = validate(createCustomerSchema, body);
    if (!check.ok) return f.setErrors(check.errors);
    try {
      const { contacts: _c, addresses: _a, ...rest } = body;
      await onSubmit(customer ? rest : body);
    } catch (err) {
      f.fail(err);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-5"
    >
      <FormGrid>
        <Field label="Company name" required error={f.errors.companyName} className="sm:col-span-2">
          <Input value={v.companyName} onChange={(e) => set('companyName', e.target.value)} autoFocus />
        </Field>
        <Field label="Status" error={f.errors.status}>
          <Select value={v.status} onChange={(e) => set('status', e.target.value)}>
            {statuses.map((st) => (
              <option key={st} value={st}>
                {humanize(st)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Legal name" error={f.errors.legalName} className="sm:col-span-2">
          <Input value={v.legalName} onChange={(e) => set('legalName', e.target.value)} />
        </Field>
        <Field label="VAT number" error={f.errors.vatNumber}>
          <Input value={v.vatNumber} onChange={(e) => set('vatNumber', e.target.value)} />
        </Field>
        <CommonSelects values={v} set={set} errors={f.errors}>
          <Field label="Destination port" error={f.errors.defaultDestinationPortId}>
            <Select
              value={v.defaultDestinationPortId}
              onChange={(e) => set('defaultDestinationPortId', e.target.value)}
            >
              <option value="">—</option>
              {destPorts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.locode})
                </option>
              ))}
            </Select>
          </Field>
        </CommonSelects>
        {canAssign && (
          <Field label="Salesperson" error={f.errors.salespersonId}>
            <Select value={v.salespersonId} onChange={(e) => set('salespersonId', e.target.value)}>
              <option value="">—</option>
              {lookups.data?.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </FormGrid>
      <fieldset className="rounded-md border border-line p-4">
        <legend className="px-1 text-xs font-semibold tracking-wide text-muted uppercase">
          Credit control
        </legend>
        <FormGrid>
          <Field
            label="Credit limit"
            error={f.errors.creditLimit}
            hint={canCredit ? undefined : 'Set by finance'}
          >
            <Input
              inputMode="decimal"
              value={v.creditLimit}
              disabled={!canCredit}
              onChange={(e) => set('creditLimit', e.target.value)}
            />
          </Field>
          <Field label="Limit currency" error={f.errors.creditLimitCurrency}>
            <Select
              value={v.creditLimitCurrency || v.defaultCurrency}
              disabled={!canCredit}
              onChange={(e) => set('creditLimitCurrency', e.target.value)}
            >
              {lookups.data?.currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </Select>
          </Field>
        </FormGrid>
      </fieldset>
      <Field label="Notes" error={f.errors.notes}>
        <Textarea value={v.notes} onChange={(e) => set('notes', e.target.value)} />
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

export function supplierInitial(x?: SupplierDto) {
  return {
    companyName: s(x?.companyName),
    legalName: s(x?.legalName),
    supplierType: x?.supplierType ?? 'MATERIAL',
    countryCode: s(x?.countryCode),
    city: s(x?.city),
    address: s(x?.address),
    phone: s(x?.phone),
    email: s(x?.email),
    whatsapp: s(x?.whatsapp),
    website: s(x?.website),
    taxId: s(x?.taxId),
    defaultCurrency: x?.defaultCurrency ?? 'USD',
    paymentTermId: s(x?.paymentTerm?.id),
    productionLeadTimeDays: x?.productionLeadTimeDays != null ? String(x.productionLeadTimeDays) : '',
    defaultIncoterm: s(x?.defaultIncoterm),
    defaultLoadingPortId: s(x?.defaultLoadingPort?.id),
    status: x?.status ?? 'ACTIVE',
    notes: s(x?.notes),
  };
}

export function SupplierForm({
  supplier,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  supplier?: SupplierDto;
  onSubmit: (body: Record<string, unknown>) => Promise<unknown>;
  onCancel?: () => void;
  submitLabel: string;
}) {
  const lookups = useLookups();
  const f = useForm(supplierInitial(supplier));
  const v = f.values;
  const set = (k: string, val: string) => f.set(k as keyof typeof v, val);
  const ports = lookups.data?.ports.filter((p) => !v.countryCode || p.countryCode === v.countryCode) ?? [];

  const submit = async () => {
    const body = clean({
      ...v,
      productionLeadTimeDays: v.productionLeadTimeDays === '' ? null : Number(v.productionLeadTimeDays),
      contacts: [],
      addresses: [],
    });
    const check = validate(createSupplierSchema, body);
    if (!check.ok) return f.setErrors(check.errors);
    try {
      const { contacts: _c, addresses: _a, ...rest } = body;
      await onSubmit(supplier ? rest : body);
    } catch (err) {
      f.fail(err);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-5"
    >
      <FormGrid>
        <Field label="Company name" required error={f.errors.companyName} className="sm:col-span-2">
          <Input value={v.companyName} onChange={(e) => set('companyName', e.target.value)} autoFocus />
        </Field>
        <Field label="Type" error={f.errors.supplierType}>
          <Select value={v.supplierType} onChange={(e) => set('supplierType', e.target.value)}>
            {SUPPLIER_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Legal name" error={f.errors.legalName} className="sm:col-span-2">
          <Input value={v.legalName} onChange={(e) => set('legalName', e.target.value)} />
        </Field>
        <Field label="Status" error={f.errors.status}>
          <Select value={v.status} onChange={(e) => set('status', e.target.value)}>
            {SUPPLIER_STATUSES.map((st) => (
              <option key={st} value={st}>
                {humanize(st)}
              </option>
            ))}
          </Select>
        </Field>
        <CommonSelects values={v} set={set} errors={f.errors}>
          <Field label="Loading port" error={f.errors.defaultLoadingPortId}>
            <Select
              value={v.defaultLoadingPortId}
              onChange={(e) => set('defaultLoadingPortId', e.target.value)}
            >
              <option value="">—</option>
              {ports.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.locode})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Production lead time (days)" error={f.errors.productionLeadTimeDays}>
            <Input
              inputMode="numeric"
              value={v.productionLeadTimeDays}
              onChange={(e) => set('productionLeadTimeDays', e.target.value)}
            />
          </Field>
        </CommonSelects>
      </FormGrid>
      <Field label="Notes" error={f.errors.notes}>
        <Textarea value={v.notes} onChange={(e) => set('notes', e.target.value)} />
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

// ───────────── Contacts & addresses (shared by customers and suppliers) ─────────────

export function ContactDialog({
  open,
  onClose,
  contact,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  contact?: ContactDto | null;
  onSave: (body: Record<string, unknown>) => Promise<unknown>;
}) {
  const init = () => ({
    name: s(contact?.name),
    position: s(contact?.position),
    phone: s(contact?.phone),
    email: s(contact?.email),
    whatsapp: s(contact?.whatsapp),
    notes: s(contact?.notes),
    isPrimary: contact?.isPrimary ?? false,
  });
  const f = useForm(init());
  useEffect(() => {
    if (open) f.reset(init()); // fresh values each time the dialog opens
  }, [open]);
  const v = f.values;
  const save = async () => {
    const body = clean(v);
    const check = validate(contactSchema, body);
    if (!check.ok) return f.setErrors(check.errors);
    try {
      await onSave(body);
      onClose();
    } catch (err) {
      f.fail(err);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={contact ? 'Edit contact' : 'Add contact'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <FormGrid columns={2}>
        <Field label="Name" required error={f.errors.name}>
          <Input value={v.name} onChange={(e) => f.set('name', e.target.value)} autoFocus />
        </Field>
        <Field label="Position" error={f.errors.position}>
          <Input value={v.position} onChange={(e) => f.set('position', e.target.value)} />
        </Field>
        <Field label="Phone" error={f.errors.phone}>
          <Input value={v.phone} onChange={(e) => f.set('phone', e.target.value)} />
        </Field>
        <Field label="WhatsApp" error={f.errors.whatsapp}>
          <Input value={v.whatsapp} onChange={(e) => f.set('whatsapp', e.target.value)} />
        </Field>
        <Field label="E-mail" error={f.errors.email} className="sm:col-span-2">
          <Input type="email" value={v.email} onChange={(e) => f.set('email', e.target.value)} />
        </Field>
        <Field label="Notes" error={f.errors.notes} className="sm:col-span-2">
          <Textarea value={v.notes} onChange={(e) => f.set('notes', e.target.value)} rows={2} />
        </Field>
        <Checkbox
          label="Primary contact"
          checked={v.isPrimary}
          onChange={(e) => f.set('isPrimary', e.target.checked)}
        />
      </FormGrid>
      <ErrorBox error={f.formError} className="mt-3" />
    </Dialog>
  );
}

export function AddressDialog({
  open,
  onClose,
  address,
  defaultCountry,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  address?: AddressDto | null;
  defaultCountry?: string;
  onSave: (body: Record<string, unknown>) => Promise<unknown>;
}) {
  const lookups = useLookups();
  const init = () => ({
    type: address?.type ?? 'SHIPPING',
    label: s(address?.label),
    line1: s(address?.line1),
    line2: s(address?.line2),
    city: s(address?.city),
    state: s(address?.state),
    postalCode: s(address?.postalCode),
    countryCode: address?.countryCode ?? defaultCountry ?? '',
    isDefault: address?.isDefault ?? false,
  });
  const f = useForm(init());
  useEffect(() => {
    if (open) f.reset(init());
  }, [open]);
  const v = f.values;
  const save = async () => {
    const body = clean(v);
    const check = validate(addressSchema, body);
    if (!check.ok) return f.setErrors(check.errors);
    try {
      await onSave(body);
      onClose();
    } catch (err) {
      f.fail(err);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={address ? 'Edit address' : 'Add address'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <FormGrid columns={2}>
        <Field label="Type" required>
          <Select value={v.type} onChange={(e) => f.set('type', e.target.value as typeof v.type)}>
            {ADDRESS_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Label" error={f.errors.label}>
          <Input
            value={v.label}
            onChange={(e) => f.set('label', e.target.value)}
            placeholder="e.g. Factory warehouse"
          />
        </Field>
        <Field label="Address line 1" required error={f.errors.line1} className="sm:col-span-2">
          <Input value={v.line1} onChange={(e) => f.set('line1', e.target.value)} />
        </Field>
        <Field label="Address line 2" error={f.errors.line2} className="sm:col-span-2">
          <Input value={v.line2} onChange={(e) => f.set('line2', e.target.value)} />
        </Field>
        <Field label="City" error={f.errors.city}>
          <Input value={v.city} onChange={(e) => f.set('city', e.target.value)} />
        </Field>
        <Field label="Postal code" error={f.errors.postalCode}>
          <Input value={v.postalCode} onChange={(e) => f.set('postalCode', e.target.value)} />
        </Field>
        <Field label="Country" required error={f.errors.countryCode}>
          <Select value={v.countryCode} onChange={(e) => f.set('countryCode', e.target.value)}>
            <option value="">Select…</option>
            {lookups.data?.countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end pb-2">
          <Checkbox
            label="Default for this type"
            checked={v.isDefault}
            onChange={(e) => f.set('isDefault', e.target.checked)}
          />
        </div>
      </FormGrid>
      <ErrorBox error={f.formError} className="mt-3" />
    </Dialog>
  );
}
