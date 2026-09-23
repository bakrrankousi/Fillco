'use client';

import type { CreditPreviewDto, SalesOrderDto, SalesOrderLineDto } from '@fillco/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { date, money, mt } from '@/lib/format';
import { StatusBadge } from './ui/badge';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Field, Input, Select, Textarea } from './ui/form';
import { ErrorBox, KeyValues, Loading, Notice } from './ui/misc';

/** Runs the credit check preview, then confirms (with an override reason when allowed). */
export function ConfirmOrderDialog({
  order,
  open,
  onClose,
  onConfirmed,
}: {
  order: SalesOrderDto;
  open: boolean;
  onClose: () => void;
  onConfirmed: (so: SalesOrderDto) => void;
}) {
  const preview = useQuery({
    queryKey: ['credit-preview', order.id, order.version],
    queryFn: () => api.get<CreditPreviewDto>(`/sales-orders/${order.id}/credit-check`),
    enabled: open,
    staleTime: 0,
  });
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
    }
  }, [open]);
  const p = preview.data;
  const needsOverride = p && p.result !== 'PASS';

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      onConfirmed(
        await api.post<SalesOrderDto>(`/sales-orders/${order.id}/confirm`, {
          version: order.version,
          overrideReason: needsOverride ? reason : null,
        }),
      );
      onClose();
    } catch (err) {
      setError(err);
      if (err instanceof ApiError && err.code === 'CREDIT_CHECK_FAILED') void preview.refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Confirm ${order.number}`}
      footer={
        <>
          <Button onClick={onClose}>Back</Button>
          {p && (!needsOverride || p.canOverride) && (
            <Button
              variant={needsOverride ? 'danger' : 'primary'}
              loading={busy}
              disabled={!!needsOverride && !reason.trim()}
              onClick={() => void confirm()}
            >
              {needsOverride ? 'Override and confirm' : 'Confirm order'}
            </Button>
          )}
        </>
      }
    >
      {!p ? (
        preview.error ? (
          <ErrorBox error={preview.error} />
        ) : (
          <Loading label="Running credit check…" />
        )
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm">
            Credit check:{' '}
            <StatusBadge
              status={p.result}
              label={
                p.result === 'PASS' ? 'Within limit' : p.result === 'WARN' ? 'Limit exceeded' : 'Blocked'
              }
            />
          </div>
          <KeyValues
            columns={2}
            items={[
              ['Credit limit', money(p.creditLimit, p.currency)],
              ['Current exposure', money(p.exposure, p.currency)],
              ['Available before this order', money(p.availableBefore, p.currency)],
              ['This order', money(p.newOrderValue, p.currency)],
              ['Counted against credit', money(p.newOrderUnsecured, p.currency)],
              [
                'Available after',
                <strong
                  key="a"
                  className={Number(p.availableAfter) < 0 ? 'text-red-700' : 'text-emerald-700'}
                >
                  {money(p.availableAfter, p.currency)}
                </strong>,
              ],
            ]}
          />
          {p.newOrderUnsecured !== p.newOrderValue && (
            <p className="text-xs text-muted">
              The advance / before-loading part of the payment terms does not use credit.
            </p>
          )}
          {needsOverride && (
            <Notice tone="warning">
              <ul className="list-disc pl-4">
                {p.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              {!p.canOverride && (
                <p className="mt-2 font-medium">
                  {p.result === 'BLOCK'
                    ? 'Management must approve this order.'
                    : 'Ask finance (credit control) to review and confirm this order.'}
                </p>
              )}
            </Notice>
          )}
          {needsOverride && p.canOverride && (
            <Field
              label="Override reason"
              required
              hint="Recorded with your name in the order history and audit log."
            >
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
            </Field>
          )}
          <ErrorBox error={error} />
        </div>
      )}
    </Dialog>
  );
}

interface SupplyLine {
  purchaseOrderLineId: string;
  purchaseOrder: { id: string; code?: string | null; name: string };
  supplier: { id: string; name: string };
  poStatus: string;
  lineNo: number;
  variantId: string;
  description: string;
  unallocatedQtyBase: string;
  unitPrice: string | null;
  uom: string;
  currency: string;
  expectedReadyDate: string | null;
}

/** Allocates a sales order line to existing unallocated supply on open purchase orders. */
export function AllocateFromSupplyDialog({
  line,
  open,
  onClose,
  onDone,
}: {
  line: SalesOrderLineDto | null;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const supply = useQuery({
    queryKey: ['open-supply', line?.productId],
    queryFn: () => api.get<SupplyLine[]>('/purchase-orders/open-supply', { productId: line!.productId }),
    enabled: open && !!line,
  });
  const [selected, setSelected] = useState('');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open && line) {
      setSelected('');
      setQty(String(Number(line.remainingToPurchaseBase) / 1000));
      setNote('');
      setError(null);
    }
  }, [open, line]);
  const rows = [...(supply.data ?? [])].sort(
    (a, b) => Number(b.variantId === line?.variantId) - Number(a.variantId === line?.variantId),
  );
  const chosen = rows.find((r) => r.purchaseOrderLineId === selected);
  const substitute = !!chosen && !!line && chosen.variantId !== line.variantId;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Allocate line ${line?.lineNo} from existing purchases`}
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
              setError(null);
              try {
                await api.post('/allocations', {
                  salesOrderLineId: line!.id,
                  purchaseOrderLineId: selected,
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
          <span className="font-medium">{line.description}</span> — remaining to purchase{' '}
          <strong>{mt(line.remainingToPurchaseBase)}</strong>
        </p>
      )}
      {!supply.data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Notice>
          No open purchase order has unallocated quantity of this product. Create a new purchase order
          instead.
        </Notice>
      ) : (
        <div className="max-h-72 overflow-y-auto rounded-md border border-line">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-muted uppercase">
              <tr>
                <th className="px-3 py-2" />
                <th className="px-3 py-2">PO</th>
                <th className="px-3 py-2">Supplier</th>
                <th className="px-3 py-2">Specification</th>
                <th className="px-3 py-2 text-right">Free</th>
                <th className="px-3 py-2">Ready</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.purchaseOrderLineId} className="border-t border-line">
                  <td className="px-3 py-2">
                    <input
                      type="radio"
                      name="supply"
                      aria-label={`${r.purchaseOrder.name} line ${r.lineNo}`}
                      checked={selected === r.purchaseOrderLineId}
                      onChange={() => setSelected(r.purchaseOrderLineId)}
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.purchaseOrder.name} <StatusBadge status={r.poStatus} />
                  </td>
                  <td className="px-3 py-2">{r.supplier.name}</td>
                  <td className="px-3 py-2">
                    {r.description}{' '}
                    {line && r.variantId !== line.variantId && (
                      <span className="text-xs text-amber-700">(different spec)</span>
                    )}
                  </td>
                  <td className="num px-3 py-2">{mt(r.unallocatedQtyBase)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{date(r.expectedReadyDate)}</td>
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
          <Field
            label="Substitute note"
            required
            hint="Why a different specification is acceptable"
            className="sm:col-span-2"
          >
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
      </div>
      <ErrorBox error={error} className="mt-3" />
    </Dialog>
  );
}

/** Lets purchasing reduce or remove an allocation. */
export function EditAllocationDialog({
  allocation,
  onClose,
  onDone,
}: {
  allocation: {
    id: string;
    qtyBase: string;
    salesOrder: { name: string };
    purchaseOrder: { name: string };
  } | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (allocation) {
      setQty(String(Number(allocation.qtyBase) / 1000));
      setReason('');
      setError(null);
    }
  }, [allocation]);
  return (
    <Dialog
      open={!!allocation}
      onClose={onClose}
      title="Change allocation"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!reason.trim() || qty === ''}
            onClick={async () => {
              setBusy(true);
              try {
                await api.patch(`/allocations/${allocation!.id}`, { qty, uom: 'MT', reason });
                onDone();
                onClose();
              } catch (err) {
                setError(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </Button>
        </>
      }
    >
      {allocation && (
        <p className="mb-3 text-sm text-slate-700">
          {allocation.salesOrder.name} ↔ {allocation.purchaseOrder.name}. Set 0 to remove the allocation.
        </p>
      )}
      <div className="space-y-3">
        <Field label="Quantity (MT)">
          <Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label="Reason" required>
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Select…</option>
            <option>Re-sourcing from another supplier</option>
            <option>Customer reduced quantity</option>
            <option>Supplier short-shipped</option>
            <option>Moved to stock</option>
            <option>Correction</option>
          </Select>
        </Field>
      </div>
      <ErrorBox error={error} className="mt-3" />
    </Dialog>
  );
}
