'use client';

import type {
  AllocationDto,
  AwaitingPurchaseItemDto,
  MilestoneDto,
  PurchaseOrderDto,
  PurchaseOrderLineDto,
} from '@fillco/contracts';
import { PurchaseOrderStatus, TRIGGER_EVENT_LABELS } from '@fillco/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuditTrail } from '@/components/audit-trail';
import { Totals } from '@/components/document-lines-table';
import { EditAllocationDialog } from '@/components/order-dialogs';
import { PurchaseOrderForm } from '@/components/purchase-order-form';
import { useToast } from '@/components/toast';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/form';
import { ErrorBox, KeyValues, Loading, Notice, PageHeader, ProgressBar } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date, dateTime, humanize, money, mt, num } from '@/lib/format';

const TRANSITION_LABEL: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Back to draft',
  SENT: 'Mark sent to supplier',
  CONFIRMED: 'Supplier confirmed',
  IN_PRODUCTION: 'In production',
  READY: 'Ready for shipment',
  CLOSED: 'Close',
  CANCELLED: 'Cancel PO',
};

function TransitionDialog({
  po,
  to,
  onClose,
  onDone,
}: {
  po: PurchaseOrderDto;
  to: PurchaseOrderStatus | null;
  onClose: () => void;
  onDone: (p: PurchaseOrderDto) => void;
}) {
  const [reason, setReason] = useState('');
  const [supplierRef, setSupplierRef] = useState('');
  const [readyDate, setReadyDate] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (to) {
      setReason('');
      setSupplierRef(po.supplierRef ?? '');
      setReadyDate(po.confirmedReadyDate ?? po.expectedReadyDate ?? '');
      setError(null);
    }
  }, [to, po]);
  if (!to) return null;
  const cancelling = to === 'CANCELLED';
  const allocated = po.lines.some((l) => l.allocations.length > 0);
  return (
    <Dialog
      open={!!to}
      onClose={onClose}
      title={`${TRANSITION_LABEL[to]} — ${po.number}`}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Back</Button>
          <Button
            variant={cancelling ? 'danger' : 'primary'}
            loading={busy}
            disabled={cancelling && !reason.trim()}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                onDone(
                  await api.post<PurchaseOrderDto>(`/purchase-orders/${po.id}/transition`, {
                    to,
                    version: po.version,
                    reason: reason || null,
                    supplierRef: to === 'CONFIRMED' ? supplierRef || null : null,
                    confirmedReadyDate: to === 'CONFIRMED' ? readyDate || null : null,
                  }),
                );
                onClose();
              } catch (err) {
                setError(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            {TRANSITION_LABEL[to]}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {to === 'CONFIRMED' && (
          <>
            <p className="text-sm text-slate-700">
              Confirmation freezes the exchange rate and creates the supplier payment schedule.
            </p>
            <Field label="Supplier reference (PI no.)">
              <Input value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} />
            </Field>
            <Field label="Confirmed ready date">
              <Input type="date" value={readyDate} onChange={(e) => setReadyDate(e.target.value)} />
            </Field>
          </>
        )}
        {cancelling && allocated && (
          <Notice tone="warning">
            Allocations to customer orders will be released; those orders will need to be purchased again.
          </Notice>
        )}
        {(cancelling || to === 'DRAFT') && (
          <Field label="Reason" required={cancelling}>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        <ErrorBox error={error} />
      </div>
    </Dialog>
  );
}

function AllocateToOrderDialog({
  line,
  onClose,
  onDone,
}: {
  line: PurchaseOrderLineDto | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const demand = useQuery({
    queryKey: ['awaiting', line?.productId],
    queryFn: () =>
      api.get<AwaitingPurchaseItemDto[]>('/sales-orders/awaiting-purchase', { productId: line!.productId }),
    enabled: !!line,
  });
  const [selected, setSelected] = useState('');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (line) {
      setSelected('');
      setQty('');
      setNote('');
      setError(null);
    }
  }, [line]);
  const rows = [...(demand.data ?? [])].sort(
    (a, b) => Number(b.variantId === line?.variantId) - Number(a.variantId === line?.variantId),
  );
  const chosen = rows.find((r) => r.salesOrderLineId === selected);
  const substitute = !!chosen && !!line && chosen.variantId !== line.variantId;
  return (
    <Dialog
      open={!!line}
      onClose={onClose}
      title={`Allocate PO line ${line?.lineNo} to a customer order`}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!chosen || !qty || (substitute && !note.trim())}
            onClick={async () => {
              setBusy(true);
              try {
                await api.post('/allocations', {
                  salesOrderLineId: selected,
                  purchaseOrderLineId: line!.id,
                  qty,
                  uom: 'MT',
                  substituteNote: substitute ? note : null,
                });
                onDone();
                onClose();
              } catch (err) {
                setError(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            Allocate
          </Button>
        </>
      }
    >
      {line && (
        <p className="mb-3 text-sm">
          <span className="font-medium">{line.description}</span> — free quantity{' '}
          <strong>{mt(line.unallocatedQtyBase)}</strong>
        </p>
      )}
      {!demand.data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Notice>No confirmed customer order is waiting for this product.</Notice>
      ) : (
        <div className="max-h-72 overflow-y-auto rounded-md border border-line">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-muted uppercase">
              <tr>
                <th className="px-3 py-2" />
                <th className="px-3 py-2">Order</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Specification</th>
                <th className="px-3 py-2 text-right">Needed</th>
                <th className="px-3 py-2">Ship by</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.salesOrderLineId} className="border-t border-line">
                  <td className="px-3 py-2">
                    <input
                      type="radio"
                      name="demand"
                      aria-label={`${r.salesOrder.name} line ${r.lineNo}`}
                      checked={selected === r.salesOrderLineId}
                      onChange={() => {
                        setSelected(r.salesOrderLineId);
                        setQty(
                          String(
                            Math.min(Number(r.remainingQtyBase), Number(line?.unallocatedQtyBase ?? 0)) /
                              1000,
                          ),
                        );
                      }}
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.salesOrder.name} / {r.lineNo}
                  </td>
                  <td className="px-3 py-2">{r.customer.name}</td>
                  <td className="px-3 py-2">
                    {r.description}{' '}
                    {line && r.variantId !== line.variantId && (
                      <span className="text-xs text-amber-700">(different spec)</span>
                    )}
                  </td>
                  <td className="num px-3 py-2">{mt(r.remainingQtyBase)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{date(r.requestedShipmentDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Field label="Quantity (MT)" required>
          <Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        {substitute && (
          <Field label="Substitute note" required className="sm:col-span-2">
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
      </div>
      <ErrorBox error={error} className="mt-3" />
    </Dialog>
  );
}

function Milestones({ po, onSaved }: { po: PurchaseOrderDto; onSaved: (p: PurchaseOrderDto) => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const editable =
    can('purchase_order.manage', 'purchase_order.confirm') &&
    !['CANCELLED', 'CLOSED', 'DRAFT'].includes(po.status);
  const save = async (m: MilestoneDto, patch: Partial<MilestoneDto>) => {
    try {
      onSaved(
        await api.put<PurchaseOrderDto>(`/purchase-orders/${po.id}/milestones`, {
          milestone: m.milestone,
          plannedDate: m.plannedDate,
          actualDate: m.actualDate,
          notes: m.notes,
          ...patch,
        }),
      );
      toast.success('Milestone saved');
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted uppercase">
        <tr>
          <th className="px-4 py-2">Milestone</th>
          <th className="px-2 py-2">Planned</th>
          <th className="px-2 py-2">Actual</th>
        </tr>
      </thead>
      <tbody>
        {po.milestones.map((m) => (
          <tr key={m.milestone} className="border-t border-line">
            <td className="px-4 py-1.5">
              {humanize(m.milestone)} {m.actualDate && <span className="text-emerald-600">✓</span>}
            </td>
            <td className="px-2 py-1.5">
              {editable ? (
                <Input
                  type="date"
                  aria-label={`${m.milestone} planned`}
                  value={m.plannedDate ?? ''}
                  onChange={(e) => void save(m, { plannedDate: e.target.value || null })}
                  className="h-7 text-xs"
                />
              ) : (
                date(m.plannedDate)
              )}
            </td>
            <td className="px-2 py-1.5">
              {editable ? (
                <Input
                  type="date"
                  aria-label={`${m.milestone} actual`}
                  value={m.actualDate ?? ''}
                  onChange={(e) => void save(m, { actualDate: e.target.value || null })}
                  className="h-7 text-xs"
                />
              ) : (
                date(m.actualDate)
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function PurchaseOrderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [transition, setTransition] = useState<PurchaseOrderStatus | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [allocateLine, setAllocateLine] = useState<PurchaseOrderLineDto | null>(null);
  const [editAllocation, setEditAllocation] = useState<AllocationDto | null>(null);
  const query = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: () => api.get<PurchaseOrderDto>(`/purchase-orders/${id}`),
  });
  if (query.error) return <ErrorBox error={query.error} />;
  if (!query.data) return <Loading />;
  const po = query.data;
  const set = (data: PurchaseOrderDto) => {
    qc.setQueryData(['purchase-order', id], data);
    void qc.invalidateQueries({ queryKey: ['/purchase-orders'] });
  };
  const showCost = po.grandTotal !== null;

  if (editing) {
    return (
      <>
        <PageHeader
          title={`Edit ${po.number}`}
          breadcrumb={{ label: 'Purchase orders', href: '/purchases' }}
        />
        <PurchaseOrderForm
          order={po}
          submitLabel="Save purchase order"
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            set(
              await api.put<PurchaseOrderDto>(`/purchase-orders/${po.id}`, { ...body, version: po.version }),
            );
            setEditing(false);
            toast.success('Purchase order saved');
          }}
        />
      </>
    );
  }

  const transitions = po.allowedTransitions.filter((t) =>
    t === 'CANCELLED' ? can('purchase_order.cancel') : can('purchase_order.confirm'),
  );
  const primary = transitions.find((t) => t !== 'CANCELLED' && t !== 'DRAFT');
  const secondary = transitions.filter((t) => t !== primary);

  return (
    <>
      <PageHeader
        breadcrumb={{ label: 'Purchase orders', href: '/purchases' }}
        title={
          <span className="flex items-center gap-2">
            {po.number} <StatusBadge status={po.status} />{' '}
            {po.isDelayed && <Badge tone="critical">Delayed</Badge>}
          </span>
        }
        subtitle={
          <>
            <Link className="text-brand-700 hover:underline" href={`/suppliers/${po.supplier.id}`}>
              {po.supplier.name}
            </Link>
            {po.supplierRef && ` · Ref ${po.supplierRef}`} · {date(po.poDate)}
          </>
        }
        actions={
          <>
            {['DRAFT', 'SENT'].includes(po.status) && can('purchase_order.manage') && (
              <Button onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
            )}
            {po.status === 'DRAFT' && can('purchase_order.delete') && (
              <Button variant="danger" onClick={() => setDeleting(true)}>
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            )}
            {secondary.map((t) => (
              <Button
                key={t}
                variant={t === 'CANCELLED' ? 'danger' : 'secondary'}
                onClick={() => setTransition(t)}
              >
                {TRANSITION_LABEL[t]}
              </Button>
            ))}
            {primary && (
              <Button variant="primary" onClick={() => setTransition(primary)}>
                {TRANSITION_LABEL[primary]}
              </Button>
            )}
          </>
        }
      />
      {po.status === 'CANCELLED' && (
        <Notice className="mb-4">
          Cancelled {dateTime(po.cancelledAt)}: {po.cancelReason}
        </Notice>
      )}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader title="Purchase order" />
            <CardBody>
              <KeyValues
                items={[
                  [
                    'Currency',
                    `${po.currency}${showCost && po.currency !== 'USD' ? ` @ ${num(po.fxRate, 6)}` : ''}`,
                  ],
                  ['Incoterm', po.incoterm],
                  ['Loading port', po.loadingPort?.name],
                  ['Payment terms', po.paymentTermSummary],
                  ['Expected ready', date(po.expectedReadyDate)],
                  ['Confirmed ready', date(po.confirmedReadyDate)],
                  ['Buyer', po.buyer?.name],
                  ['Sent', dateTime(po.sentAt)],
                  ['Confirmed', dateTime(po.confirmedAt)],
                ]}
              />
              {po.notes && (
                <p className="mt-4 rounded-md bg-slate-50 p-3 text-sm whitespace-pre-wrap">{po.notes}</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Products & customer allocations" />
            <div className="divide-y divide-line">
              {po.lines.map((l) => (
                <div key={l.id} className="px-4 py-3" data-testid={`po-line-${l.lineNo}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">
                        {l.lineNo}. {l.description}
                      </p>
                      <p className="text-xs text-muted">
                        {num(l.qty, 4)} {l.uom}
                        {showCost &&
                          ` × ${money(l.unitPrice)} ${po.currency} = ${money(l.lineTotal, po.currency)}`}
                        {l.expectedReadyDate && ` · ready ${date(l.expectedReadyDate)}`}
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-56 text-xs">
                        <div className="mb-1 flex justify-between">
                          <span>Allocated {mt(l.allocatedQtyBase)}</span>
                          <span className="text-muted">free {mt(l.unallocatedQtyBase)}</span>
                        </div>
                        <ProgressBar value={(Number(l.allocatedQtyBase) / Number(l.qtyBase)) * 100} />
                      </div>
                      {can('allocation.manage') &&
                        Number(l.unallocatedQtyBase) > 0 &&
                        !['CANCELLED', 'CLOSED'].includes(po.status) && (
                          <Button size="sm" onClick={() => setAllocateLine(l)}>
                            <Link2 className="h-3.5 w-3.5" /> Allocate
                          </Button>
                        )}
                    </div>
                  </div>
                  {l.allocations.length > 0 && (
                    <table className="mt-2 w-full text-xs">
                      <tbody>
                        {l.allocations.map((a) => (
                          <tr key={a.id} className="border-t border-dashed border-line">
                            <td className="py-1 pr-2">
                              <Link
                                href={`/sales-orders/${a.salesOrder.id}`}
                                className="font-medium text-brand-700 hover:underline"
                              >
                                {a.salesOrder.name}
                              </Link>{' '}
                              line {a.soLineNo}
                            </td>
                            <td className="py-1 pr-2">{a.customer.name}</td>
                            <td className="num py-1 pr-2">{mt(a.qtyBase)}</td>
                            <td className="py-1 pr-2 text-amber-700">
                              {a.isSubstitute ? `Substitute: ${a.substituteNote}` : ''}
                            </td>
                            <td className="py-1 text-right">
                              {can('allocation.manage') && po.status !== 'CLOSED' && (
                                <button
                                  className="text-muted hover:text-ink"
                                  onClick={() => setEditAllocation(a)}
                                >
                                  Change
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
            </div>
            {showCost && (
              <div className="flex justify-end border-t border-line px-4 py-2">
                <Totals
                  rows={[
                    ['PO total', money(po.grandTotal, po.currency), true],
                    ...(po.currency !== 'USD'
                      ? ([['In base currency', money(po.grandTotalBase)]] as [string, string][])
                      : []),
                  ]}
                />
              </div>
            )}
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Customer orders served" />
            {po.salesOrders.length === 0 ? (
              <p className="p-4 text-sm text-muted">Stock purchase — not yet allocated to customers.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {po.salesOrders.map((s) => (
                  <li key={s.id} className="px-4 py-2">
                    <Link
                      href={`/sales-orders/${s.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {s.name}
                    </Link>
                    <span className="block text-xs text-muted">{s.customer.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Production milestones" />
            <Milestones po={po} onSaved={set} />
          </Card>
          {po.paymentSchedule && (
            <Card>
              <CardHeader title="Supplier payment schedule" subtitle={po.paymentTermSummary ?? undefined} />
              {po.paymentSchedule.length === 0 ? (
                <p className="p-4 text-sm text-muted">Created when the supplier confirms the PO.</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {po.paymentSchedule.map((s) => (
                    <li key={s.seq} className="px-4 py-2">
                      <div className="flex justify-between">
                        <span>
                          {num(s.percent)}% {s.offsetDays ? `${s.offsetDays} days after` : 'at'}{' '}
                          {TRIGGER_EVENT_LABELS[s.triggerEvent]}
                        </span>
                        <span className="font-medium tabular-nums">{money(s.amount, po.currency)}</span>
                      </div>
                      <div className="text-xs text-muted">
                        {s.dueDate ? `Due ${date(s.dueDate)}` : `Estimated ${date(s.estimatedDueDate)}`}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          <Card>
            <CardHeader title="Timeline" />
            <ol className="space-y-3 px-4 py-3">
              {po.timeline.map((e) => (
                <li key={e.id} className="relative border-l-2 border-line pl-3">
                  <span className="absolute top-1.5 -left-[5px] h-2 w-2 rounded-full bg-brand-500" />
                  <p className="text-sm">{e.summary}</p>
                  <p className="text-xs text-muted">
                    {dateTime(e.occurredAt)}
                    {e.user ? ` · ${e.user.name}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
      {can('audit.view') && (
        <div className="mt-4">
          <AuditTrail entityType="purchase_order" entityId={po.id} />
        </div>
      )}
      <TransitionDialog
        po={po}
        to={transition}
        onClose={() => setTransition(null)}
        onDone={(p) => {
          set(p);
          toast.success(`Purchase order ${humanize(p.status).toLowerCase()}`);
        }}
      />
      <AllocateToOrderDialog
        line={allocateLine}
        onClose={() => setAllocateLine(null)}
        onDone={() => {
          void query.refetch();
          toast.success('Allocated');
        }}
      />
      <EditAllocationDialog
        allocation={editAllocation}
        onClose={() => setEditAllocation(null)}
        onDone={() => {
          void query.refetch();
          toast.success('Allocation updated');
        }}
      />
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete draft purchase order"
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          await api.delete(`/purchase-orders/${po.id}`);
          await qc.invalidateQueries({ queryKey: ['/purchase-orders'] });
          toast.success('Draft deleted');
          router.push('/purchases');
        }}
      >
        Delete draft {po.number}? Any allocations on it are released.
      </ConfirmDialog>
    </>
  );
}
