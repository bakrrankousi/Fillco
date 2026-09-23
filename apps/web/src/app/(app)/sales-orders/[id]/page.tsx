'use client';

import type { AllocationDto, SalesOrderDto, SalesOrderLineDto } from '@fillco/contracts';
import { TRIGGER_EVENT_LABELS } from '@fillco/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, MoreHorizontal, Pencil, Send, ShoppingBag, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ReactNode, useState } from 'react';
import { AuditTrail } from '@/components/audit-trail';
import { Totals } from '@/components/document-lines-table';
import {
  AllocateFromSupplyDialog,
  ConfirmOrderDialog,
  EditAllocationDialog,
} from '@/components/order-dialogs';
import { SalesOrderForm } from '@/components/sales-order-form';
import { useToast } from '@/components/toast';
import { Badge, SoStatusBadge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog, ReasonDialog } from '@/components/ui/dialog';
import { ErrorBox, KeyValues, Loading, Notice, PageHeader, ProgressBar } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date, dateTime, money, mt, num, pct } from '@/lib/format';

type ReasonAction = {
  title: string;
  label: string;
  danger?: boolean;
  description?: string;
  run: (reason: string) => Promise<SalesOrderDto>;
};

function Planned({ title, phase, children }: { title: string; phase: number; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} actions={<Badge tone="muted">Phase {phase}</Badge>} />
      <CardBody className="text-sm text-muted">{children}</CardBody>
    </Card>
  );
}

function LineActions({
  line,
  order,
  onAction,
}: {
  line: SalesOrderLineDto;
  order: SalesOrderDto;
  onAction: (a: 'allocate' | 'short' | 'cancel') => void;
}) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  if (line.lineStatus !== 'OPEN' || !['CONFIRMED', 'ON_HOLD'].includes(order.status)) return null;
  const items: [string, 'allocate' | 'short' | 'cancel', boolean][] = [
    [
      'Allocate from existing PO',
      'allocate',
      can('allocation.manage') && order.status === 'CONFIRMED' && Number(line.remainingToPurchaseBase) > 0,
    ],
    ['Close line short', 'short', can('sales_order.cancel')],
    ['Cancel line', 'cancel', can('sales_order.cancel') && line.allocations.length === 0],
  ];
  const visible = items.filter(([, , show]) => show);
  if (!visible.length) return null;
  return (
    <div className="relative">
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Actions for line ${line.lineNo}`}
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-line bg-white py-1 text-left shadow-lg">
          {visible.map(([label, key]) => (
            <button
              key={key}
              type="button"
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => (setOpen(false), onAction(key))}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SalesOrderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reasonAction, setReasonAction] = useState<ReasonAction | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [allocating, setAllocating] = useState<SalesOrderLineDto | null>(null);
  const [editAllocation, setEditAllocation] = useState<AllocationDto | null>(null);
  const [busy, setBusy] = useState(false);

  const query = useQuery({
    queryKey: ['sales-order', id],
    queryFn: () => api.get<SalesOrderDto>(`/sales-orders/${id}`),
  });
  if (query.error) return <ErrorBox error={query.error} />;
  if (!query.data) return <Loading />;
  const so = query.data;
  const set = (data: SalesOrderDto) => {
    qc.setQueryData(['sales-order', id], data);
    void qc.invalidateQueries({ queryKey: ['/sales-orders'] });
  };
  const reload = () => void query.refetch();

  if (editing) {
    return (
      <>
        <PageHeader
          title={`Edit ${so.number}`}
          breadcrumb={{ label: 'Sales orders', href: '/sales-orders' }}
        />
        <SalesOrderForm
          order={so}
          submitLabel="Save order"
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            set(await api.put<SalesOrderDto>(`/sales-orders/${so.id}`, { ...body, version: so.version }));
            setEditing(false);
            toast.success('Order saved');
          }}
        />
      </>
    );
  }

  const draft = so.status === 'DRAFT' || so.status === 'PENDING_CONFIRMATION';
  const open = so.status === 'CONFIRMED' || so.status === 'ON_HOLD';
  const f = so.finance;
  const hasAllocations = so.lines.some((l) => l.allocations.length > 0);
  const canConfirm = can('sales_order.confirm', 'credit.override', 'credit.override_block');

  const reasonCall = (
    title: string,
    label: string,
    path: string,
    opts: { danger?: boolean; description?: string } = {},
  ) =>
    setReasonAction({
      title,
      label,
      ...opts,
      run: (reason) =>
        api.post<SalesOrderDto>(`/sales-orders/${so.id}/${path}`, { version: so.version, reason }),
    });

  return (
    <>
      <PageHeader
        breadcrumb={{ label: 'Sales orders', href: '/sales-orders' }}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {so.number} <SoStatusBadge status={so.displayStatus} />
            {so.customerStatus !== 'ACTIVE' && so.customerStatus !== 'PROSPECT' && (
              <StatusBadge
                status={so.customerStatus}
                label={`Customer ${so.customerStatus.toLowerCase().replace('_', ' ')}`}
              />
            )}
          </span>
        }
        subtitle={
          <>
            <Link className="text-brand-700 hover:underline" href={`/customers/${so.customer.id}`}>
              {so.customer.name}
            </Link>
            {so.customerPoRef && ` · Customer PO ${so.customerPoRef}`} · {date(so.orderDate)}
            {so.quotation && (
              <>
                {' · from '}
                <Link className="text-brand-700 hover:underline" href={`/quotations/${so.quotation.id}`}>
                  {so.quotation.name}
                </Link>
              </>
            )}
          </>
        }
        actions={
          <>
            {draft && can('sales_order.manage') && (
              <Button onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
            )}
            {so.status === 'DRAFT' && !so.confirmedAt && can('sales_order.delete') && (
              <Button variant="danger" onClick={() => setDeleting(true)}>
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            )}
            {so.status === 'DRAFT' && can('sales_order.manage') && (
              <Button
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    set(
                      await api.post<SalesOrderDto>(`/sales-orders/${so.id}/submit`, { version: so.version }),
                    );
                    toast.success('Marked as sent for customer confirmation');
                  } catch (err) {
                    toast.error(err);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Send className="h-4 w-4" /> Sent to customer
              </Button>
            )}
            {draft && canConfirm && (
              <Button variant="primary" onClick={() => setConfirming(true)}>
                <CheckCircle2 className="h-4 w-4" /> Confirm order
              </Button>
            )}
            {so.status === 'CONFIRMED' &&
              can('purchase_order.manage') &&
              so.displayStatus !== 'FULLY_PURCHASED' && (
                <Link href={`/purchases/awaiting?q=${encodeURIComponent(so.number)}`}>
                  <Button variant="primary">
                    <ShoppingBag className="h-4 w-4" /> Purchase
                  </Button>
                </Link>
              )}
            {so.status === 'CONFIRMED' && can('sales_order.cancel') && (
              <Button onClick={() => reasonCall('Put order on hold', 'Hold order', 'hold')}>Hold</Button>
            )}
            {so.status === 'ON_HOLD' && can('sales_order.cancel') && (
              <Button onClick={() => reasonCall('Release order from hold', 'Release', 'release')}>
                Release
              </Button>
            )}
            {open && !hasAllocations && can('sales_order.cancel') && (
              <Button
                onClick={() =>
                  reasonCall('Reopen order for changes', 'Reopen', 'reopen', {
                    description:
                      'The order goes back to draft; the payment schedule is recalculated on the next confirmation.',
                  })
                }
              >
                Reopen
              </Button>
            )}
            {(draft || open) && so.confirmedAt && can('sales_order.cancel') && (
              <Button
                variant="danger"
                onClick={() =>
                  reasonCall('Cancel order', 'Cancel order', 'cancel', {
                    danger: true,
                    description: hasAllocations
                      ? 'Purchase allocations will be released; the purchased goods stay on their POs as free stock.'
                      : undefined,
                  })
                }
              >
                Cancel order
              </Button>
            )}
          </>
        }
      />

      {so.status === 'CANCELLED' && (
        <Notice className="mb-4">
          Cancelled {dateTime(so.cancelledAt)}: {so.cancelReason}
        </Notice>
      )}
      {so.status === 'PENDING_CONFIRMATION' && (
        <Notice className="mb-4">Sent to the customer, waiting for their confirmation.</Notice>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="px-4 py-3">
          <p className="text-xs text-muted">Order value</p>
          <p className="text-lg font-semibold tabular-nums">{money(so.grandTotal, so.currency)}</p>
          {so.currency !== f.baseCurrency && (
            <p className="text-xs text-muted">
              ≈ {money(so.grandTotalBase, f.baseCurrency)} @ {num(so.fxRate, 6)}
            </p>
          )}
        </Card>
        <Card className="px-4 py-3">
          <p className="text-xs text-muted">Purchased</p>
          <p className="text-lg font-semibold">{pct(so.purchasedPct, 0)}</p>
          <ProgressBar value={Number(so.purchasedPct)} />
        </Card>
        <Card className="px-4 py-3">
          <p className="text-xs text-muted">Shipped</p>
          <p className="text-lg font-semibold">{pct(so.shippedPct, 0)}</p>
          <p className="text-xs text-muted">Shipments arrive in Phase 2</p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-xs text-muted">Estimated gross profit (purchased part)</p>
          {f.estimatedGrossProfitBase === null ? (
            <p className="text-sm text-muted">Visible to finance</p>
          ) : (
            <>
              <p className="text-lg font-semibold tabular-nums">
                {money(f.estimatedGrossProfitBase, f.baseCurrency)}
              </p>
              <p className="text-xs text-muted">Margin {pct(f.estimatedMarginPct)} before freight & costs</p>
            </>
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader title="Order" />
            <CardBody>
              <KeyValues
                items={[
                  ['Incoterm', so.incoterm],
                  [
                    'Destination',
                    [so.destinationPort?.name, so.destinationCountry].filter(Boolean).join(', ') || null,
                  ],
                  ['Requested shipment', date(so.requestedShipmentDate)],
                  ['Payment terms', so.paymentTermSummary ?? '—'],
                  ['Salesperson', so.salesperson?.name],
                  ['Confirmed', dateTime(so.confirmedAt)],
                  [
                    'Ship to',
                    so.shippingAddress
                      ? [so.shippingAddress.line1, so.shippingAddress.city, so.shippingAddress.countryCode]
                          .filter(Boolean)
                          .join(', ')
                      : null,
                  ],
                  [
                    'Bill to',
                    so.billingAddress
                      ? [so.billingAddress.line1, so.billingAddress.city, so.billingAddress.countryCode]
                          .filter(Boolean)
                          .join(', ')
                      : null,
                  ],
                ]}
              />
              {so.notes && (
                <p className="mt-4 rounded-md bg-slate-50 p-3 text-sm whitespace-pre-wrap">{so.notes}</p>
              )}
              {so.internalNotes && <p className="mt-2 text-xs text-muted">Internal: {so.internalNotes}</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Products & purchasing"
              subtitle="Quantities in metric tons; purchases come from one or more supplier POs"
            />
            <div className="divide-y divide-line">
              {so.lines.map((l) => (
                <div
                  key={l.id}
                  className={l.lineStatus === 'CANCELLED' ? 'px-4 py-3 opacity-60' : 'px-4 py-3'}
                  data-testid={`so-line-${l.lineNo}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {l.lineNo}. {l.description}{' '}
                        {l.lineStatus !== 'OPEN' && <StatusBadge status={l.lineStatus} />}
                      </p>
                      <p className="text-xs text-muted">
                        {num(l.qty, 4)} {l.uom} × {money(l.unitPrice)} {so.currency}
                        {Number(l.discountPct) ? ` − ${num(l.discountPct)}%` : ''} ={' '}
                        {money(l.lineTotal, so.currency)} · ±{num(l.tolerancePct)}% tolerance
                        {l.closedReason ? ` · ${l.closedReason}` : ''}
                      </p>
                    </div>
                    <div className="flex items-start gap-4">
                      <div className="w-56 text-xs">
                        <div className="mb-1 flex justify-between">
                          <span>Purchased {mt(l.purchasedQtyBase)}</span>
                          <span className="text-muted">of {mt(l.qtyBase)}</span>
                        </div>
                        <ProgressBar value={(Number(l.purchasedQtyBase) / Number(l.qtyBase)) * 100} />
                        {Number(l.remainingToPurchaseBase) > 0 && l.lineStatus === 'OPEN' && (
                          <p className="mt-1 text-orange-700">
                            Remaining to purchase {mt(l.remainingToPurchaseBase)}
                          </p>
                        )}
                      </div>
                      <LineActions
                        line={l}
                        order={so}
                        onAction={(a) => {
                          if (a === 'allocate') setAllocating(l);
                          if (a === 'short' || a === 'cancel')
                            setReasonAction({
                              title:
                                a === 'short' ? `Close line ${l.lineNo} short` : `Cancel line ${l.lineNo}`,
                              label: a === 'short' ? 'Close short' : 'Cancel line',
                              danger: a === 'cancel',
                              description:
                                a === 'short'
                                  ? 'Nothing more will be purchased or shipped for this line.'
                                  : 'The line is removed from the order value and the payment schedule is recalculated.',
                              run: (reason) =>
                                api.post<SalesOrderDto>(
                                  `/sales-orders/${so.id}/lines/${l.id}/${a === 'short' ? 'close-short' : 'cancel'}`,
                                  { reason },
                                ),
                            });
                        }}
                      />
                    </div>
                  </div>
                  {l.allocations.length > 0 && (
                    <table className="mt-2 w-full text-xs">
                      <tbody>
                        {l.allocations.map((a) => (
                          <tr key={a.id} className="border-t border-dashed border-line">
                            <td className="py-1 pr-2">
                              <Link
                                href={`/purchases/${a.purchaseOrder.id}`}
                                className="font-medium text-brand-700 hover:underline"
                              >
                                {a.purchaseOrder.name}
                              </Link>{' '}
                              <StatusBadge status={a.poStatus} />
                            </td>
                            <td className="py-1 pr-2">{a.supplier.name}</td>
                            <td className="num py-1 pr-2">{mt(a.qtyBase)}</td>
                            <td className="num py-1 pr-2 text-muted">
                              {a.unitCostBase !== null
                                ? `${money(Number(a.unitCostBase) * 1000)} ${a.poCurrency}/MT`
                                : ''}
                            </td>
                            <td className="py-1 pr-2 text-amber-700">
                              {a.isSubstitute ? `Substitute: ${a.substituteNote}` : ''}
                            </td>
                            <td className="py-1 text-right">
                              {can('allocation.manage') && a.poStatus !== 'CLOSED' && (
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
            <div className="flex justify-end border-t border-line px-4 py-2">
              <Totals
                rows={[
                  ...(Number(so.discountTotal)
                    ? ([['Discount', `−${money(so.discountTotal)}`]] as [string, string][])
                    : []),
                  ['Order total', money(so.grandTotal, so.currency), true],
                ]}
              />
            </div>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Planned title="Shipments & containers" phase={2}>
              Bookings, containers, BL, ETD/ETA and partial shipments will appear here.
            </Planned>
            <Planned title="Invoices & payments" phase={2}>
              Invoices, collections and outstanding balance will appear here.
            </Planned>
            <Planned title="Documents" phase={2}>
              Commercial invoice, packing list, BL, COO and COA per shipment.
            </Planned>
            <Planned title="Tasks" phase={4}>
              Follow-ups such as “request advance payment” or “request COO”.
            </Planned>
          </div>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Suppliers & purchase orders" />
            {so.purchaseOrders.length === 0 ? (
              <p className="p-4 text-sm text-muted">Nothing purchased yet.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {so.purchaseOrders.map((po) => (
                  <li key={po.id} className="flex items-center justify-between gap-2 px-4 py-2">
                    <span>
                      <Link
                        href={`/purchases/${po.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {po.name}
                      </Link>
                      <span className="block text-xs text-muted">
                        {po.supplier.name}
                        {po.expectedReadyDate ? ` · ready ${date(po.expectedReadyDate)}` : ''}
                      </span>
                    </span>
                    <StatusBadge status={po.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Finance" subtitle={`Base currency ${f.baseCurrency}`} />
            <CardBody>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted">Sales value</dt>
                  <dd className="tabular-nums">{money(f.salesValueBase, f.baseCurrency)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Purchase cost (committed)</dt>
                  <dd className="tabular-nums">
                    {f.purchaseCostBase === null ? '—' : money(f.purchaseCostBase, f.baseCurrency)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Cost coverage</dt>
                  <dd>{pct(f.costCoveragePct, 0)} of quantity</dd>
                </div>
                <div className="flex justify-between border-t border-line pt-1.5 font-medium">
                  <dt>Estimated gross profit</dt>
                  <dd className="tabular-nums">
                    {f.estimatedGrossProfitBase === null
                      ? '—'
                      : money(f.estimatedGrossProfitBase, f.baseCurrency)}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-muted">
                Freight, insurance, bank charges and actual costs arrive with Phase 3 profitability.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Payment schedule" subtitle={so.paymentTermSummary ?? 'No payment terms'} />
            {so.paymentSchedule.length === 0 ? (
              <p className="p-4 text-sm text-muted">
                {draft ? 'Created when the order is confirmed.' : 'No schedule.'}
              </p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {so.paymentSchedule.map((s) => (
                  <li key={s.seq} className="px-4 py-2">
                    <div className="flex justify-between">
                      <span>
                        {num(s.percent)}% {s.offsetDays ? `${s.offsetDays} days after` : 'at'}{' '}
                        {TRIGGER_EVENT_LABELS[s.triggerEvent]}
                      </span>
                      <span className="font-medium tabular-nums">{money(s.amount, so.currency)}</span>
                    </div>
                    <div className="text-xs text-muted">
                      {s.dueDate
                        ? `Due ${date(s.dueDate)}`
                        : `Estimated ${date(s.estimatedDueDate)} — waiting for ${TRIGGER_EVENT_LABELS[s.triggerEvent]}`}
                      {s.instrument ? ` · ${s.instrument}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {so.creditChecks.length > 0 && (
            <Card>
              <CardHeader title="Credit checks" />
              <ul className="divide-y divide-line text-sm">
                {so.creditChecks.map((c) => (
                  <li key={c.id} className="px-4 py-2">
                    <div className="flex items-center justify-between">
                      <StatusBadge status={c.result} />
                      <span className="text-xs text-muted">
                        {dateTime(c.evaluatedAt)} · {c.evaluatedBy?.name}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      Limit {money(c.creditLimit, c.currency)} · exposure {money(c.exposure, c.currency)} ·
                      after order {money(c.availableAfter, c.currency)}
                    </p>
                    {c.override && (
                      <p className="mt-1 text-xs text-amber-800">
                        Overridden by {c.override.approvedBy.name}: “{c.override.reason}”
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader title="Timeline" />
            <ol className="relative space-y-3 px-4 py-3">
              {so.timeline.map((e) => (
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
          <AuditTrail entityType="sales_order" entityId={so.id} />
        </div>
      )}

      <ConfirmOrderDialog
        order={so}
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirmed={(data) => {
          set(data);
          toast.success(`Order ${data.number} confirmed`);
        }}
      />
      <ReasonDialog
        open={!!reasonAction}
        onClose={() => setReasonAction(null)}
        title={reasonAction?.title ?? ''}
        confirmLabel={reasonAction?.label ?? ''}
        danger={reasonAction?.danger}
        description={reasonAction?.description}
        onConfirm={async (reason) => {
          set(await reasonAction!.run(reason));
          toast.success('Done');
        }}
      />
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete draft order"
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          await api.delete(`/sales-orders/${so.id}`);
          await qc.invalidateQueries({ queryKey: ['/sales-orders'] });
          toast.success('Draft deleted');
          router.push('/sales-orders');
        }}
      >
        Delete draft {so.number}? This cannot be undone.
      </ConfirmDialog>
      <AllocateFromSupplyDialog
        line={allocating}
        open={!!allocating}
        onClose={() => setAllocating(null)}
        onDone={() => {
          reload();
          toast.success('Allocated');
        }}
      />
      <EditAllocationDialog
        allocation={editAllocation}
        onClose={() => setEditAllocation(null)}
        onDone={() => {
          reload();
          toast.success('Allocation updated');
        }}
      />
    </>
  );
}
