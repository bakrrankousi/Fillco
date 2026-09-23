'use client';

import type { CustomerListItemDto, Page, SupplierListItemDto } from '@fillco/contracts';
import { useQuery } from '@tanstack/react-query';
import { ReactNode } from 'react';
import { api } from '@/lib/api';
import type { FieldErrors } from '@/lib/forms';
import { useLookups } from '@/lib/queries';
import { Field, Input, Select } from './ui/form';

export function useCustomerOptions() {
  return useQuery({
    queryKey: ['/customers', 'options'],
    queryFn: () => api.get<Page<CustomerListItemDto>>('/customers', { pageSize: 500, sort: 'companyName' }),
    staleTime: 60_000,
  });
}

export function useSupplierOptions(type?: string) {
  return useQuery({
    queryKey: ['/suppliers', 'options', type],
    queryFn: () =>
      api.get<Page<SupplierListItemDto>>('/suppliers', {
        pageSize: 500,
        sort: 'companyName',
        status: 'ACTIVE',
        supplierType: type,
      }),
    staleTime: 60_000,
  });
}

export function CurrencySelect({
  value,
  onChange,
  error,
  label = 'Currency',
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string[];
  label?: string;
}) {
  const lookups = useLookups();
  return (
    <Field label={label} required error={error}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        {lookups.data?.currencies
          .filter((c) => c.isActive)
          .map((c) => (
            <option key={c.code} value={c.code}>
              {c.code}
            </option>
          ))}
      </Select>
    </Field>
  );
}

export function IncotermSelect({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string[];
}) {
  const lookups = useLookups();
  return (
    <Field label="Incoterm" error={error}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {lookups.data?.incoterms.map((i) => (
          <option key={i.code} value={i.code}>
            {i.code} — {i.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function PortSelect({
  label,
  value,
  onChange,
  countryCode,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  countryCode?: string;
  error?: string[];
}) {
  const lookups = useLookups();
  const ports =
    lookups.data?.ports.filter((p) => p.isActive && (!countryCode || p.countryCode === countryCode)) ?? [];
  return (
    <Field label={label} error={error}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {ports.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.locode})
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function TermSelect({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string[];
}) {
  const lookups = useLookups();
  const term = lookups.data?.paymentTerms.find((t) => t.id === value);
  return (
    <Field label="Payment terms" error={error} hint={term?.summary}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {lookups.data?.paymentTerms
          .filter((t) => t.isActive || t.id === value)
          .map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
      </Select>
    </Field>
  );
}

export function DateField({
  label,
  value,
  onChange,
  error,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string[];
  required?: boolean;
}) {
  return (
    <Field label={label} error={error} required={required}>
      <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function Section({
  title,
  children,
  aside,
}: {
  title: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export type { FieldErrors };
