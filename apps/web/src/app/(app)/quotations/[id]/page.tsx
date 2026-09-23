'use client';

import type { QuotationDto, QuotationLineDto } from '@fillco/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Copy, Pencil, Send, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { AuditTrail } from '@/components/audit-trail';
import { DocumentLinesTable, Totals } from '@/components/document-lines-table';
import { QuotationForm } from '@/components/quotation-form';
import { useToast } from '@/components/toast';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/form';
import { ErrorBox, KeyValues, Loading, Notice, PageHeader } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date, dateTime, money, pct } from '@/lib/format';

export default function QuotationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [decision, setDecision] = useState<'accept' | 'reject' | null>(null);
  const [note, setNote] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['quotation', id],
    queryFn: () => api.get<QuotationDto>(`/quotations/${id}`),
  });
  if (query.error) return <ErrorBox error={query.error} />;
  if (!query.data) return <Loading />;
  const q = query.data;
  const manage = can('quotation.manage');

  const run = async (label: string, fn: () => Promise<QuotationDto | void>, success: string) => {
    setBusy(label);
    try {
      const result = await fn();
      if (result) {
        if (result.id !== q.id) router.push(`/quotations/${result.id}`);
        else qc.setQueryData(['quotation', id], result);
      }
      await qc.invalidateQueries({ queryKey: ['/quotations'] });
      toast.success(success);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  if (editing) {
    return (
      <>
        <PageHeader
          title={`Edit ${q.number} rev ${q.revision}`}
          breadcrumb={{ label: 'Quotations', href: '/quotations' }}
        />
        <QuotationForm
          quotation={q}
          submitLabel="Save quotation"
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            qc.setQueryData(
              ['quotation', id],
              await api.put<QuotationDto>(`/quotations/${q.id}`, { ...body, version: q.version }),
            );
            setEditing(false);
            toast.success('Quotation saved');
          }}
        />
      </>
    );
  }

  const showCost = can('finance.view_costs');
  return (
    <>
      <PageHeader
        breadcrumb={{ label: 'Quotations', href: '/quotations' }}
        title={
          <span className="flex items-center gap-2">
            {q.number} {q.revision > 1 && <span className="text-muted">rev {q.revision}</span>}{' '}
            <StatusBadge status={q.isExpired ? 'EXPIRED' : q.status} />
          </span>
        }
        subtitle={
          <>
            <Link className="text-brand-700 hover:underline" href={`/customers/${q.customer.id}`}>
              {q.customer.name}
            </Link>{' '}
            · {date(q.quotationDate)} · valid until {date(q.validUntil)}
          </>
        }
        actions={
          manage && (
            <>
              {q.status === 'DRAFT' && (
                <>
                  <Button onClick={() => setEditing(true)}>
                    <Pencil className="h-4 w-4" /> Edit
                  </Button>
                  {can('quotation.delete') && (
                    <Button variant="danger" onClick={() => setDeleting(true)}>
                      <Trash2 className="h-4 w-4" /> Delete
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    loading={busy === 'send'}
                    onClick={() => run('send', () => api.post(`/quotations/${q.id}/send`), 'Marked as sent')}
                  >
                    <Send className="h-4 w-4" /> Mark as sent
                  </Button>
                </>
              )}
              {['SENT', 'REJECTED', 'EXPIRED', 'ACCEPTED'].includes(q.status) && (
                <Button
                  loading={busy === 'revise'}
                  onClick={() =>
                    run('revise', () => api.post(`/quotations/${q.id}/revise`), 'New revision created')
                  }
                >
                  <Copy className="h-4 w-4" /> Revise
                </Button>
              )}
              {q.status === 'SENT' && (
                <>
                  <Button onClick={() => setDecision('reject')}>
                    <ThumbsDown className="h-4 w-4" /> Rejected
                  </Button>
                  <Button onClick={() => setDecision('accept')}>
                    <ThumbsUp className="h-4 w-4" /> Accepted
                  </Button>
                </>
              )}
              {['SENT', 'ACCEPTED'].includes(q.status) && can('sales_order.manage') && (
                <Button
                  variant="primary"
                  loading={busy === 'convert'}
                  onClick={async () => {
                    setBusy('convert');
                    try {
                      const { salesOrderId } = await api.post<{ salesOrderId: string }>(
                        `/quotations/${q.id}/convert`,
                      );
                      await qc.invalidateQueries({ queryKey: ['/sales-orders'] });
                      toast.success('Sales order created from quotation');
                      router.push(`/sales-orders/${salesOrderId}`);
                    } catch (err) {
                      toast.error(err);
                      setBusy(null);
                    }
                  }}
                >
                  <ArrowRightLeft className="h-4 w-4" /> Convert to order
                </Button>
              )}
            </>
          )
        }
      />
      {q.isExpired && (
        <Notice tone="warning" className="mb-4">
          This quotation has passed its validity date. Create a revision to re-quote.
        </Notice>
      )}
      {q.salesOrders.length > 0 && (
        <Notice tone="success" className="mb-4">
          Converted to{' '}
          {q.salesOrders.map((s) => (
            <Link key={s.id} href={`/sales-orders/${s.id}`} className="font-medium underline">
              {s.name}
            </Link>
          ))}
        </Notice>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Terms" />
          <CardBody>
            <KeyValues
              items={[
                ['Currency', q.currency],
                ['Incoterm', q.incoterm],
                [
                  'Destination',
                  [q.destinationPort?.name, q.destinationCountry].filter(Boolean).join(', ') || null,
                ],
                ['Payment terms', q.paymentTermSummary ?? q.paymentTerm?.name],
                ['Estimated shipment', date(q.estimatedShipmentDate)],
                ['Salesperson', q.salesperson?.name],
              ]}
            />
            {q.notes && (
              <p className="mt-4 rounded-md bg-slate-50 p-3 text-sm whitespace-pre-wrap">{q.notes}</p>
            )}
            {q.internalNotes && <p className="mt-2 text-xs text-muted">Internal: {q.internalNotes}</p>}
            {q.decisionNote && <p className="mt-2 text-sm">Decision note: {q.decisionNote}</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Revisions" />
          <ul className="divide-y divide-line text-sm">
            {q.revisions.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-4 py-2">
                <Link
                  href={`/quotations/${r.id}`}
                  className={r.id === q.id ? 'font-semibold' : 'text-brand-700 hover:underline'}
                >
                  Rev {r.revision} · {date(r.quotationDate)}
                </Link>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{money(r.grandTotal)}</span>
                  <StatusBadge status={r.status} />
                </span>
              </li>
            ))}
          </ul>
          {q.sentAt && <p className="px-4 pb-3 text-xs text-muted">Sent {dateTime(q.sentAt)}</p>}
        </Card>
      </div>
      <Card className="mt-4">
        <CardHeader title="Products" />
        <DocumentLinesTable<QuotationLineDto>
          lines={q.lines}
          currency={q.currency}
          extra={
            showCost
              ? [
                  {
                    key: 'cost',
                    header: 'Est. cost',
                    align: 'right',
                    cell: (l) => (l.estUnitCost ? money(l.estUnitCost) : '—'),
                  },
                  { key: 'margin', header: 'Est. margin', align: 'right', cell: (l) => pct(l.estMarginPct) },
                ]
              : []
          }
          footer={
            <Totals
              rows={[
                ...(Number(q.discountTotal)
                  ? ([['Discount', `−${money(q.discountTotal)}`]] as [string, string][])
                  : []),
                ['Total', money(q.grandTotal, q.currency), true],
              ]}
            />
          }
        />
      </Card>
      {can('audit.view') && (
        <div className="mt-4">
          <AuditTrail entityType="quotation" entityId={q.id} />
        </div>
      )}
      <Dialog
        open={decision !== null}
        onClose={() => setDecision(null)}
        title={decision === 'accept' ? 'Customer accepted' : 'Customer rejected'}
        size="sm"
        footer={
          <>
            <Button onClick={() => setDecision(null)}>Back</Button>
            <Button
              variant="primary"
              loading={busy === 'decision'}
              onClick={async () => {
                await run(
                  'decision',
                  () => api.post(`/quotations/${q.id}/${decision}`, { note: note || null }),
                  decision === 'accept' ? 'Marked accepted' : 'Marked rejected',
                );
                setDecision(null);
                setNote('');
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <Field label="Note (optional)" hint="e.g. who confirmed and how">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
        </Field>
      </Dialog>
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete draft quotation"
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          await api.delete(`/quotations/${q.id}`);
          await qc.invalidateQueries({ queryKey: ['/quotations'] });
          toast.success('Draft deleted');
          router.push('/quotations');
        }}
      >
        Delete draft {q.number} rev {q.revision}?{' '}
        {q.revision > 1 && 'The previous revision becomes current again.'}
      </ConfirmDialog>
    </>
  );
}
