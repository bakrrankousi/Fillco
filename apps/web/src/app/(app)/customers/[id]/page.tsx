'use client';

import type {
  AddressDto,
  ContactDto,
  CreditExposureDto,
  CustomerDto,
  Page,
  QuotationListItemDto,
  SalesOrderListItemDto,
} from '@fillco/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { AuditTrail } from '@/components/audit-trail';
import { CreditPanel } from '@/components/credit-panel';
import { AddressDialog, ContactDialog, CustomerForm } from '@/components/party-forms';
import { useToast } from '@/components/toast';
import { Badge, SoStatusBadge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { EmptyState, ErrorBox, KeyValues, Loading, PageHeader } from '@/components/ui/misc';
import { DataTable } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date, humanize, money } from '@/lib/format';

type Tab = 'overview' | 'credit' | 'contacts' | 'addresses' | 'orders' | 'quotations' | 'history';

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);
  const [contact, setContact] = useState<ContactDto | null | 'new'>(null);
  const [address, setAddress] = useState<AddressDto | null | 'new'>(null);
  const [removeContact, setRemoveContact] = useState<ContactDto | null>(null);

  const customer = useQuery({
    queryKey: ['customer', id],
    queryFn: () => api.get<CustomerDto>(`/customers/${id}`),
  });
  const exposure = useQuery({
    queryKey: ['customer', id, 'exposure'],
    queryFn: () => api.get<CreditExposureDto>(`/customers/${id}/exposure`),
  });
  const orders = useQuery({
    queryKey: ['/sales-orders', { customerId: id }],
    queryFn: () => api.get<Page<SalesOrderListItemDto>>('/sales-orders', { customerId: id, pageSize: 100 }),
    enabled: tab === 'orders' && can('sales_order.view'),
  });
  const quotations = useQuery({
    queryKey: ['/quotations', { customerId: id }],
    queryFn: () => api.get<Page<QuotationListItemDto>>('/quotations', { customerId: id, pageSize: 100 }),
    enabled: tab === 'quotations' && can('quotation.view'),
  });

  if (customer.error) return <ErrorBox error={customer.error} />;
  if (!customer.data) return <Loading />;
  const c = customer.data;
  const refresh = (data: CustomerDto) => {
    qc.setQueryData(['customer', id], data);
    void qc.invalidateQueries({ queryKey: ['customer', id, 'exposure'] });
  };
  const canEdit = can('customer.edit', 'customer.credit_limit.edit', 'customer.archive');

  return (
    <>
      <PageHeader
        breadcrumb={{ label: 'Customers', href: '/customers' }}
        title={
          <span className="flex items-center gap-2">
            {c.companyName} <StatusBadge status={c.status} />
          </span>
        }
        subtitle={`${c.code} · ${c.countryCode}${c.city ? ` · ${c.city}` : ''}${c.salesperson ? ` · Salesperson: ${c.salesperson.name}` : ''}`}
        actions={
          <>
            {can('quotation.manage') && (
              <Link href={`/quotations/new?customerId=${c.id}`}>
                <Button>New quotation</Button>
              </Link>
            )}
            {can('sales_order.manage') && (
              <Link href={`/sales-orders/new?customerId=${c.id}`}>
                <Button>New order</Button>
              </Link>
            )}
            {canEdit && (
              <Button variant="primary" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
            )}
          </>
        }
      />
      <Tabs<Tab>
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'credit', label: 'Credit & exposure' },
          { key: 'contacts', label: 'Contacts', count: c.contacts.length },
          { key: 'addresses', label: 'Addresses', count: c.addresses.length },
          { key: 'orders', label: 'Sales orders', hidden: !can('sales_order.view') },
          { key: 'quotations', label: 'Quotations', hidden: !can('quotation.view') },
          { key: 'history', label: 'History', hidden: !can('audit.view') },
        ]}
      />

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Company" />
            <CardBody>
              <KeyValues
                items={[
                  ['Legal name', c.legalName],
                  ['Country', c.countryCode],
                  ['City', c.city],
                  ['Address', c.address],
                  ['Phone', c.phone],
                  ['E-mail', c.email],
                  ['WhatsApp', c.whatsapp],
                  ['Website', c.website],
                  ['Tax ID / VAT', [c.taxId, c.vatNumber].filter(Boolean).join(' / ') || null],
                  ['Currency', c.defaultCurrency],
                  ['Payment terms', c.paymentTerm?.name],
                  [
                    'Incoterm / port',
                    [c.defaultIncoterm, c.defaultDestinationPort?.name].filter(Boolean).join(' · ') || null,
                  ],
                ]}
              />
              {c.notes && (
                <p className="mt-4 rounded-md bg-slate-50 p-3 text-sm whitespace-pre-wrap">{c.notes}</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Credit" />
            <CardBody>{exposure.data ? <CreditPanel exposure={exposure.data} /> : <Loading />}</CardBody>
          </Card>
        </div>
      )}

      {tab === 'credit' && (
        <Card>
          <CardHeader title="Credit exposure" subtitle={`All amounts in ${c.creditLimitCurrency}`} />
          <CardBody>{exposure.data ? <CreditPanel exposure={exposure.data} /> : <Loading />}</CardBody>
        </Card>
      )}

      {tab === 'contacts' && (
        <Card>
          <CardHeader
            title="Contacts"
            actions={
              can('customer.edit') && (
                <Button size="sm" onClick={() => setContact('new')}>
                  <Plus className="h-4 w-4" /> Add contact
                </Button>
              )
            }
          />
          <DataTable
            rows={c.contacts}
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
              {
                key: 'email',
                header: 'E-mail',
                cell: (r) =>
                  r.email ? (
                    <a className="text-brand-700 hover:underline" href={`mailto:${r.email}`}>
                      {r.email}
                    </a>
                  ) : (
                    '—'
                  ),
              },
              {
                key: 'actions',
                header: '',
                align: 'right',
                cell: (r) =>
                  can('customer.edit') && (
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
      )}

      {tab === 'addresses' && (
        <Card>
          <CardHeader
            title="Addresses"
            actions={
              can('customer.edit') && (
                <Button size="sm" onClick={() => setAddress('new')}>
                  <Plus className="h-4 w-4" /> Add address
                </Button>
              )
            }
          />
          <DataTable
            rows={c.addresses}
            rowKey={(r) => r.id}
            empty="No addresses yet."
            columns={[
              {
                key: 'type',
                header: 'Type',
                cell: (r) => (
                  <span>
                    {humanize(r.type)} {r.isDefault && <Badge tone="info">Default</Badge>}
                  </span>
                ),
              },
              { key: 'label', header: 'Label', cell: (r) => r.label ?? '—' },
              {
                key: 'address',
                header: 'Address',
                cell: (r) =>
                  [r.line1, r.line2, r.postalCode, r.city, r.countryCode].filter(Boolean).join(', '),
              },
              {
                key: 'actions',
                header: '',
                align: 'right',
                cell: (r) =>
                  can('customer.edit') && (
                    <Button size="sm" variant="ghost" aria-label="Edit address" onClick={() => setAddress(r)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
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
              rowHref={(r) => `/sales-orders/${r.id}`}
              empty="No sales orders yet."
              columns={[
                { key: 'number', header: 'Order', cell: (r) => r.number },
                { key: 'date', header: 'Date', cell: (r) => date(r.orderDate) },
                {
                  key: 'total',
                  header: 'Value',
                  align: 'right',
                  cell: (r) => money(r.grandTotal, r.currency),
                },
                { key: 'status', header: 'Status', cell: (r) => <SoStatusBadge status={r.displayStatus} /> },
              ]}
            />
          ) : (
            <Loading />
          )}
        </Card>
      )}

      {tab === 'quotations' && (
        <Card>
          {quotations.data ? (
            <DataTable
              rows={quotations.data.items}
              rowKey={(r) => r.id}
              rowHref={(r) => `/quotations/${r.id}`}
              empty="No quotations yet."
              columns={[
                { key: 'number', header: 'Quotation', cell: (r) => `${r.number} rev ${r.revision}` },
                { key: 'date', header: 'Date', cell: (r) => date(r.quotationDate) },
                { key: 'valid', header: 'Valid until', cell: (r) => date(r.validUntil) },
                {
                  key: 'total',
                  header: 'Value',
                  align: 'right',
                  cell: (r) => money(r.grandTotal, r.currency),
                },
                {
                  key: 'status',
                  header: 'Status',
                  cell: (r) => <StatusBadge status={r.isExpired ? 'EXPIRED' : r.status} />,
                },
              ]}
            />
          ) : (
            <Loading />
          )}
        </Card>
      )}

      {tab === 'history' && <AuditTrail entityType="customer" entityId={c.id} />}

      <Dialog open={editing} onClose={() => setEditing(false)} title={`Edit ${c.companyName}`} size="lg">
        <CustomerForm
          customer={c}
          submitLabel="Save changes"
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            const updated = await api.patch<CustomerDto>(`/customers/${c.id}`, {
              ...body,
              version: c.version,
            });
            refresh(updated);
            await qc.invalidateQueries({ queryKey: ['/customers'] });
            setEditing(false);
            toast.success('Customer saved');
          }}
        />
      </Dialog>
      <ContactDialog
        open={contact !== null}
        onClose={() => setContact(null)}
        contact={contact === 'new' ? null : contact}
        onSave={async (body) => {
          const updated =
            contact && contact !== 'new'
              ? await api.put<CustomerDto>(`/customers/${c.id}/contacts/${contact.id}`, body)
              : await api.post<CustomerDto>(`/customers/${c.id}/contacts`, body);
          refresh(updated);
          toast.success('Contact saved');
        }}
      />
      <AddressDialog
        open={address !== null}
        onClose={() => setAddress(null)}
        address={address === 'new' ? null : address}
        defaultCountry={c.countryCode}
        onSave={async (body) => {
          const updated =
            address && address !== 'new'
              ? await api.put<CustomerDto>(`/customers/${c.id}/addresses/${address.id}`, body)
              : await api.post<CustomerDto>(`/customers/${c.id}/addresses`, body);
          refresh(updated);
          toast.success('Address saved');
        }}
      />
      <ConfirmDialog
        open={!!removeContact}
        onClose={() => setRemoveContact(null)}
        title="Remove contact"
        confirmLabel="Remove"
        danger
        onConfirm={async () => {
          refresh(await api.delete<CustomerDto>(`/customers/${c.id}/contacts/${removeContact!.id}`));
          toast.success('Contact removed');
        }}
      >
        Remove {removeContact?.name} from {c.companyName}?
      </ConfirmDialog>
      {!c.contacts.length && tab === 'overview' && (
        <div className="mt-4">
          <EmptyState title="No contacts yet">
            Add the purchasing contact so documents and reminders reach the right person.
          </EmptyState>
        </div>
      )}
    </>
  );
}
