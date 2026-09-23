'use client';

import { updateCompanySchema, type CompanyDto } from '@fillco/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, FormGrid, Input, Select, Textarea } from '@/components/ui/form';
import { ErrorBox, Loading, Notice } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { clean, useForm, validate } from '@/lib/forms';
import { useLookups } from '@/lib/queries';

const ZONES = [
  'Europe/Istanbul',
  'Africa/Cairo',
  'Asia/Dubai',
  'Asia/Riyadh',
  'Asia/Amman',
  'Africa/Casablanca',
  'Asia/Shanghai',
  'Europe/London',
  'UTC',
];

export function CompanySettings() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const lookups = useLookups();
  const company = useQuery({
    queryKey: ['company'],
    queryFn: () => api.get<CompanyDto>('/settings/company'),
  });
  const f = useForm({
    name: '',
    legalName: '',
    taxId: '',
    address: '',
    city: '',
    countryCode: '',
    phone: '',
    email: '',
    website: '',
    baseCurrency: 'USD',
    timezone: 'Europe/Istanbul',
    blockOverdueDays: '30',
    defaultTolerancePct: '5',
    invoiceFooter: '',
  });
  useEffect(() => {
    const c = company.data;
    if (c)
      f.reset({
        name: c.name,
        legalName: c.legalName ?? '',
        taxId: c.taxId ?? '',
        address: c.address ?? '',
        city: c.city ?? '',
        countryCode: c.countryCode ?? '',
        phone: c.phone ?? '',
        email: c.email ?? '',
        website: c.website ?? '',
        baseCurrency: c.baseCurrency,
        timezone: c.timezone,
        blockOverdueDays: String(c.blockOverdueDays),
        defaultTolerancePct: c.defaultTolerancePct,
        invoiceFooter: c.invoiceFooter ?? '',
      });
  }, [company.data]);
  if (!company.data) return company.error ? <ErrorBox error={company.error} /> : <Loading />;
  const c = company.data;
  const v = f.values;
  const readOnly = !can('settings.manage');
  const save = async () => {
    const body = { ...clean(v), blockOverdueDays: Number(v.blockOverdueDays), version: c.version };
    const check = validate(updateCompanySchema, body);
    if (!check.ok) return f.setErrors(check.errors);
    try {
      qc.setQueryData(['company'], await api.patch<CompanyDto>('/settings/company', body));
      await qc.invalidateQueries({ queryKey: ['lookups'] });
      toast.success('Company settings saved');
    } catch (err) {
      f.fail(err);
    }
  };
  const input = (key: keyof typeof v, label: string, span = false) => (
    <Field label={label} error={f.errors[key]} className={span ? 'sm:col-span-2' : undefined}>
      <Input value={v[key]} disabled={readOnly} onChange={(e) => f.set(key, e.target.value)} />
    </Field>
  );
  return (
    <Card>
      <CardHeader title="Company" />
      <CardBody className="space-y-4">
        <FormGrid>
          {input('name', 'Trading name')}
          {input('legalName', 'Legal name', true)}
          {input('taxId', 'Tax ID')}
          {input('address', 'Address', true)}
          {input('city', 'City')}
          <Field label="Country">
            <Select
              value={v.countryCode}
              disabled={readOnly}
              onChange={(e) => f.set('countryCode', e.target.value)}
            >
              <option value="">—</option>
              {lookups.data?.countries.map((x) => (
                <option key={x.code} value={x.code}>
                  {x.name}
                </option>
              ))}
            </Select>
          </Field>
          {input('phone', 'Phone')}
          {input('email', 'E-mail')}
          {input('website', 'Website')}
          <Field
            label="Base / reporting currency"
            error={f.errors.baseCurrency}
            hint={
              c.baseCurrencyEditable
                ? 'Locked once the first order is confirmed'
                : 'Locked: confirmed documents exist'
            }
          >
            <Select
              value={v.baseCurrency}
              disabled={readOnly || !c.baseCurrencyEditable}
              onChange={(e) => f.set('baseCurrency', e.target.value)}
            >
              {lookups.data?.currencies.map((x) => (
                <option key={x.code}>{x.code}</option>
              ))}
            </Select>
          </Field>
          <Field label="Timezone (defines “today” for due dates)" error={f.errors.timezone}>
            <Select
              value={v.timezone}
              disabled={readOnly}
              onChange={(e) => f.set('timezone', e.target.value)}
            >
              {[...new Set([v.timezone, ...ZONES])].map((z) => (
                <option key={z}>{z}</option>
              ))}
            </Select>
          </Field>
          <Field label="Block orders when overdue more than (days)" error={f.errors.blockOverdueDays}>
            <Input
              inputMode="numeric"
              value={v.blockOverdueDays}
              disabled={readOnly}
              onChange={(e) => f.set('blockOverdueDays', e.target.value)}
            />
          </Field>
          <Field label="Default quantity tolerance ±%" error={f.errors.defaultTolerancePct}>
            <Input
              inputMode="decimal"
              value={v.defaultTolerancePct}
              disabled={readOnly}
              onChange={(e) => f.set('defaultTolerancePct', e.target.value)}
            />
          </Field>
        </FormGrid>
        <Field label="Invoice footer (bank details, legal text)">
          <Textarea
            value={v.invoiceFooter}
            disabled={readOnly}
            onChange={(e) => f.set('invoiceFooter', e.target.value)}
          />
        </Field>
        {readOnly && <Notice>Only administrators can change company settings.</Notice>}
        <ErrorBox error={f.formError} />
        {!readOnly && (
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => void save()}>
              Save
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
