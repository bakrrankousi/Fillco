'use client';

import {
  bankAccountSchema,
  type BankAccountDto,
  type ContactDto,
  type Page,
  type PurchaseOrderListItemDto,
  type SupplierDto,
} from '@fillco/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuditTrail } from '@/components/audit-trail';
import { AddressDialog, ContactDialog, SupplierForm } from '@/components/party-forms';
import { useToast } from '@/components/toast';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog, Dialog, ReasonDialog } from '@/components/ui/dialog';
import { Field, FormGrid, Input, Select, Textarea } from '@/components/ui/form';
import { ErrorBox, KeyValues, Loading, Notice, PageHeader } from '@/components/ui/misc';
import { DataTable } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { clean, useForm, validate } from '@/lib/forms';
import { date, dateTime, humanize, money } from '@/lib/format';
import { useLookups } from '@/lib/queries';

type Tab = 'overview' | 'contacts' | 'bank' | 'orders' | 'history';

function BankAccountDialog({
  open,
  onClose,
  currency,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  currency: string;
  onSave: (b: Record<string, unknown>) => Promise<unknown>;
}) {
  const lookups = useLookups();
  const init = () => ({
    bankName: '',
    accountName: '',
    iban: '',
    accountNumber: '',
    swift: '',
    currency,
    bankAddress: '',
    notes: '',
  });
  const f = useForm(init());
  useEffect(() => {
    if (open) f.reset(init());
  }, [open]);
  const v = f.values;
  const save = async () => {
    const body = clean(v);
    const check = validate(bankAccountSchema, body);
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
      title="Add bank account"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()}>
            Submit for approval
          </Button>
        </>
      }
    >
      <Notice tone="warning" className="mb-4">
        New bank details can only be paid after a second person approves them. Always confirm changes by phone
        with a known contact — never only by e-mail.
      </Notice>
      <FormGrid columns={2}>
        <Field label="Bank name" required error={f.errors.bankName}>
          <Input value={v.bankName} onChange={(e) => f.set('bankName', e.target.value)} autoFocus />
        </Field>
        <Field label="Account holder" required error={f.errors.accountName}>
          <Input value={v.accountName} onChange={(e) => f.set('accountName', e.target.value)} />
        </Field>
        <Field label="IBAN" error={f.errors.iban}>
          <Input value={v.iban} onChange={(e) => f.set('iban', e.target.value)} />
        </Field>
        <Field label="Account number (if no IBAN)" error={f.errors.accountNumber}>
          <Input value={v.accountNumber} onChange={(e) => f.set('accountNumber', e.target.value)} />
        </Field>
        <Field label="SWIFT / BIC" error={f.errors.swift}>
          <Input value={v.swift} onChange={(e) => f.set('swift', e.target.value)} />
        </Field>
        <Field label="Currency" required error={f.errors.currency}>
          <Select value={v.currency} onChange={(e) => f.set('currency', e.target.value)}>
            {lookups.data?.currencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Bank address" error={f.errors.bankAddress} className="sm:col-span-2">
          <Input value={v.bankAddress} onChange={(e) => f.set('bankAddress', e.target.value)} />
        </Field>
        <Field label="Notes" error={f.errors.notes} className="sm:col-span-2">
          <Textarea value={v.notes} onChange={(e) => f.set('notes', e.target.value)} rows={2} />
        </Field>
      </FormGrid>
      <ErrorBox error={f.formError} className="mt-3" />
    </Dialog>
  );
}

export default function SupplierPage() {
  const { id } = useParams<{ id: string }>();
  const { can, me } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);
  const [contact, setContact] = useState<ContactDto | null | 'new'>(null);
  const [addingAddress, setAddingAddress] = useState(false);
  const [removeContact, setRemoveContact] = useState<ContactDto | null>(null);
  const [addingBank, setAddingBank] = useState(false);
  const [revoke, setRevoke] = useState<BankAccountDto | null>(null);

  const supplier = useQuery({
    queryKey: ['supplier', id],
    queryFn: () => api.get<SupplierDto>(`/suppliers/${id}`),
  });
  const orders = useQuery({
    queryKey: ['/purchase-orders', { supplierId: id }],
    queryFn: () =>
      api.get<Page<PurchaseOrderListItemDto>>('/purchase-orders', { supplierId: id, pageSize: 100 }),
    enabled: tab === 'orders' && can('purchase_order.view'),
  });
  if (supplier.error) return <ErrorBox error={supplier.error} />;
  if (!supplier.data) return <Loading />;
  const s = supplier.data;
  const refresh = (data: SupplierDto) => qc.setQueryData(['supplier', id], data);
  const pendingBanks = s.bankAccounts?.filter((b) => b.status === 'PENDING_APPROVAL').length ?? 0;

  return (
    <>
      <PageHeader
        breadcrumb={{ label: 'Suppliers', href: '/suppliers' }}
        title={
          <span className="flex items-center gap-2">
            {s.companyName} <StatusBadge status={s.status} />
          </span>
        }
        subtitle={`${s.code} · ${humanize(s.supplierType)} · ${s.countryCode}${s.city ? ` · ${s.city}` : ''}`}
        actions={
          can('supplier.edit', 'supplier.archive') && (
            <Button variant="primary" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          )
        }
      />
      <Tabs<Tab>
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'contacts', label: 'Contacts & addresses', count: s.contacts.length },
          {
            key: 'bank',
            label: pendingBanks ? `Bank accounts · ${pendingBanks} pending` : 'Bank accounts',
            hidden: s.bankAccounts === null,
          },
          { key: 'orders', label: 'Purchase orders', hidden: !can('purchase_order.view') },
          { key: 'history', label: 'History', hidden: !can('audit.view') },
        ]}
      />
      {tab === 'overview' && (
        <Card>
          <CardHeader title="Supplier" />
          <CardBody>
            <KeyValues
              items={[
                ['Legal name', s.legalName],
                ['Country', s.countryCode],
                ['City', s.city],
                ['Address', s.address],
                ['Phone', s.phone],
                ['E-mail', s.email],
                ['WhatsApp', s.whatsapp],
                ['Currency', s.defaultCurrency],
                ['Payment terms', s.paymentTerm?.name],
                ['Incoterm', s.defaultIncoterm],
                ['Loading port', s.defaultLoadingPort?.name],
                [
                  'Production lead time',
                  s.productionLeadTimeDays != null ? `${s.productionLeadTimeDays} days` : null,
                ],
              ]}
            />
            {s.notes && (
              <p className="mt-4 rounded-md bg-slate-50 p-3 text-sm whitespace-pre-wrap">{s.notes}</p>
            )}
          </CardBody>
        </Card>
      )}
      {tab === 'contacts' && (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Contacts"
              actions={
                can('supplier.edit') && (
                  <Button size="sm" onClick={() => setContact('new')}>
                    <Plus className="h-4 w-4" /> Add contact
                  </Button>
                )
              }
            />
            <DataTable
              rows={s.contacts}
              rowKey={(r) => r.id}
              empty="No contacts yet."
              columns={[
                {
                  key: 'name',
                  header: 'Name',
                  cell: (r) => (
                    <span className="font-medium">
                      {r.name} {r.isPrimary && <Badge tone="info">Primary</Badge>}
                    </span>
                  ),
                },
                { key: 'position', header: 'Position', cell: (r) => r.position ?? '—' },
                { key: 'phone', header: 'Phone', cell: (r) => r.phone ?? '—' },
                { key: 'wa', header: 'WhatsApp', cell: (r) => r.whatsapp ?? '—' },
                { key: 'email', header: 'E-mail', cell: (r) => r.email ?? '—' },
                {
                  key: 'a',
                  header: '',
                  align: 'right',
                  cell: (r) =>
                    can('supplier.edit') && (
                      <span className="inline-flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Edit ${r.name}`}
                          onClick={() => setContact(r)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Remove ${r.name}`}
                          onClick={() => setRemoveContact(r)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </span>
                    ),
                },
              ]}
            />
          </Card>
          <Card>
            <CardHeader
              title="Addresses"
              actions={
                can('supplier.edit') && (
                  <Button size="sm" onClick={() => setAddingAddress(true)}>
                    <Plus className="h-4 w-4" /> Add address
                  </Button>
                )
              }
            />
            <DataTable
              rows={s.addresses}
              rowKey={(r) => r.id}
              empty="No addresses yet."
              columns={[
                { key: 'type', header: 'Type', cell: (r) => humanize(r.type) },
                {
                  key: 'address',
                  header: 'Address',
                  cell: (r) => [r.line1, r.line2, r.city, r.countryCode].filter(Boolean).join(', '),
                },
              ]}
            />
          </Card>
        </div>
      )}
      {tab === 'bank' && s.bankAccounts && (
        <Card>
          <CardHeader
            title="Bank accounts"
            subtitle="Four-eyes rule: details entered by one person must be approved by another before payment."
            actions={
              can('supplier_bank.manage') && (
                <Button size="sm" onClick={() => setAddingBank(true)}>
                  <Plus className="h-4 w-4" /> Add bank account
                </Button>
              )
            }
          />
          <DataTable
            rows={s.bankAccounts}
            rowKey={(r) => r.id}
            empty="No bank accounts."
            columns={[
              { key: 'bank', header: 'Bank', cell: (r) => <span className="font-medium">{r.bankName}</span> },
              { key: 'holder', header: 'Account holder', cell: (r) => r.accountName },
              {
                key: 'iban',
                header: 'IBAN / account',
                cell: (r) => <span className="font-mono text-xs">{r.iban ?? r.accountNumber}</span>,
              },
              {
                key: 'swift',
                header: 'SWIFT',
                cell: (r) => <span className="font-mono text-xs">{r.swift ?? '—'}</span>,
              },
              { key: 'cur', header: 'Currency', cell: (r) => r.currency },
              { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
              {
                key: 'who',
                header: 'Entered / approved',
                cell: (r) => (
                  <span className="text-xs text-muted">
                    {r.createdBy?.name ?? '—'} · {date(r.createdAt.slice(0, 10))}
                    {r.approvedBy && (
                      <>
                        <br />✓ {r.approvedBy.name} · {dateTime(r.approvedAt)}
                      </>
                    )}
                  </span>
                ),
              },
              {
                key: 'actions',
                header: '',
                align: 'right',
                cell: (r) => (
                  <span className="inline-flex gap-1">
                    {r.status === 'PENDING_APPROVAL' &&
                      can('supplier_bank.approve') &&
                      r.createdBy?.id !== me?.id && (
                        <Button
                          size="sm"
                          variant="subtle"
                          onClick={async () => {
                            try {
                              refresh(
                                await api.post<SupplierDto>(
                                  `/suppliers/${s.id}/bank-accounts/${r.id}/approve`,
                                ),
                              );
                              toast.success('Bank account approved');
                            } catch (err) {
                              toast.error(err);
                            }
                          }}
                        >
                          <ShieldCheck className="h-3.5 w-3.5" /> Approve
                        </Button>
                      )}
                    {r.status !== 'REVOKED' && can('supplier_bank.manage') && (
                      <Button size="sm" variant="ghost" onClick={() => setRevoke(r)}>
                        Revoke
                      </Button>
                    )}
                  </span>
                ),
              },
            ]}
          />
        </Card>
      )}
      {tab === 'orders' && (
        <Card>
          {orders.data ? (
            <DataTable
              rows={orders.data.items}
              rowKey={(r) => r.id}
              rowHref={(r) => `/purchases/${r.id}`}
              empty="No purchase orders yet."
              columns={[
                { key: 'n', header: 'PO', cell: (r) => r.number },
                { key: 'd', header: 'Date', cell: (r) => date(r.poDate) },
                { key: 't', header: 'Value', align: 'right', cell: (r) => money(r.grandTotal, r.currency) },
                { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
              ]}
            />
          ) : (
            <Loading />
          )}
        </Card>
      )}
      {tab === 'history' && <AuditTrail entityType="supplier" entityId={s.id} />}

      <Dialog open={editing} onClose={() => setEditing(false)} title={`Edit ${s.companyName}`} size="lg">
        <SupplierForm
          supplier={s}
          submitLabel="Save changes"
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            refresh(await api.patch<SupplierDto>(`/suppliers/${s.id}`, { ...body, version: s.version }));
            await qc.invalidateQueries({ queryKey: ['/suppliers'] });
            setEditing(false);
            toast.success('Supplier saved');
          }}
        />
      </Dialog>
      <ContactDialog
        open={contact !== null}
        onClose={() => setContact(null)}
        contact={contact === 'new' ? null : contact}
        onSave={async (body) => {
          refresh(
            contact && contact !== 'new'
              ? await api.put<SupplierDto>(`/suppliers/${s.id}/contacts/${contact.id}`, body)
              : await api.post<SupplierDto>(`/suppliers/${s.id}/contacts`, body),
          );
          toast.success('Contact saved');
        }}
      />
      <AddressDialog
        open={addingAddress}
        onClose={() => setAddingAddress(false)}
        defaultCountry={s.countryCode}
        onSave={async (body) => {
          refresh(await api.post<SupplierDto>(`/suppliers/${s.id}/addresses`, body));
          toast.success('Address added');
        }}
      />
      <ConfirmDialog
        open={!!removeContact}
        onClose={() => setRemoveContact(null)}
        title="Remove contact"
        confirmLabel="Remove"
        danger
        onConfirm={async () => {
          refresh(await api.delete<SupplierDto>(`/suppliers/${s.id}/contacts/${removeContact!.id}`));
        }}
      >
        Remove {removeContact?.name}?
      </ConfirmDialog>
      <BankAccountDialog
        open={addingBank}
        onClose={() => setAddingBank(false)}
        currency={s.defaultCurrency}
        onSave={async (body) => {
          refresh(await api.post<SupplierDto>(`/suppliers/${s.id}/bank-accounts`, body));
          toast.success('Bank account submitted for approval');
        }}
      />
      <ReasonDialog
        open={!!revoke}
        onClose={() => setRevoke(null)}
        title="Revoke bank account"
        confirmLabel="Revoke"
        danger
        description={`${revoke?.bankName} ${revoke?.iban ?? revoke?.accountNumber ?? ''} will no longer be usable for payments.`}
        onConfirm={async (reason) => {
          refresh(
            await api.post<SupplierDto>(`/suppliers/${s.id}/bank-accounts/${revoke!.id}/revoke`, { reason }),
          );
          toast.success('Bank account revoked');
        }}
      />
    </>
  );
}
