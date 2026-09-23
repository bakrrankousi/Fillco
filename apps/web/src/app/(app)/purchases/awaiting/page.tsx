'use client';

import type { AwaitingPurchaseItemDto, PurchaseOrderDto } from '@fillco/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShoppingBag } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import {
  CurrencySelect,
  DateField,
  IncotermSelect,
  TermSelect,
  useSupplierOptions,
} from '@/components/document-form';
import { ExportButton, SearchInput } from '@/components/list-page';
import { useToast } from '@/components/toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormGrid, Input, Select } from '@/components/ui/form';
import { ErrorBox, Loading, PageHeader } from '@/components/ui/misc';
import { Toolbar } from '@/components/ui/table';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { addDaysIso, date, money, mt, todayIso } from '@/lib/format';
import { useUrlState } from '@/lib/queries';

interface Row extends AwaitingPurchaseItemDto {
  qty: string;
  price: string;
}

function CreatePoDialog({
  rows,
  open,
  onClose,
}: {
  rows: AwaitingPurchaseItemDto[];
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const suppliers = useSupplierOptions('MATERIAL');
  const today = todayIso();
  const [supplierId, setSupplierId] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [incoterm, setIncoterm] = useState('FOB');
  const [termId, setTermId] = useState('');
  const [ready, setReady] = useState(addDaysIso(today, 21));
  const [supplierRef, setSupplierRef] = useState('');
  const [lines, setLines] = useState<Row[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setLines(rows.map((r) => ({ ...r, qty: String(Number(r.remainingQtyBase) / 1000), price: '' })));
      setError(null);
    }
  }, [open, rows]);
  const pickSupplier = (id: string) => {
    setSupplierId(id);
    const s = suppliers.data?.items.find((x) => x.id === id);
    if (!s) return;
    setCurrency(s.defaultCurrency);
    if (s.defaultIncoterm) setIncoterm(s.defaultIncoterm);
    setTermId(s.paymentTermId ?? '');
    if (s.productionLeadTimeDays) setReady(addDaysIso(today, s.productionLeadTimeDays));
  };
  const total = lines.reduce((acc, l) => acc + Number(l.qty || 0) * Number(l.price || 0), 0);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create purchase order for selected lines"
      size="xl"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!supplierId || lines.some((l) => !l.qty || !l.price)}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const po = await api.post<PurchaseOrderDto>('/purchase-orders/from-sales', {
                  supplierId,
                  poDate: today,
                  currency,
                  incoterm: incoterm || null,
                  paymentTermId: termId || null,
                  expectedReadyDate: ready || null,
                  supplierRef: supplierRef || null,
                  lines: lines.map((l) => ({
                    salesOrderLineId: l.salesOrderLineId,
                    qty: l.qty,
                    uom: 'MT',
                    unitPrice: l.price,
                  })),
                });
                await qc.invalidateQueries({ queryKey: ['awaiting'] });
                await qc.invalidateQueries({ queryKey: ['/purchase-orders'] });
                toast.success(`Purchase order ${po.number} created and allocated`);
                router.push(`/purchases/${po.id}`);
              } catch (err) {
                setError(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            Create draft PO
          </Button>
        </>
      }
    >
      <FormGrid columns={4}>
        <Field label="Supplier" required className="sm:col-span-2">
          <Select value={supplierId} onChange={(e) => pickSupplier(e.target.value)} autoFocus>
            <option value="">Select a supplier…</option>
            {suppliers.data?.items.map((s) => (
              <option key={s.id} value={s.id}>
                {s.companyName} ({s.countryCode})
                {s.productionLeadTimeDays ? ` · ${s.productionLeadTimeDays}d lead time` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <CurrencySelect value={currency} onChange={setCurrency} />
        <IncotermSelect value={incoterm} onChange={setIncoterm} />
        <div className="sm:col-span-2">
          <TermSelect value={termId} onChange={setTermId} />
        </div>
        <DateField label="Expected ready" value={ready} onChange={setReady} />
        <Field label="Supplier reference">
          <Input value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} />
        </Field>
      </FormGrid>
      <table className="mt-4 w-full text-sm">
        <thead className="text-left text-xs text-muted uppercase">
          <tr>
            <th className="py-2">Customer order line</th>
            <th className="py-2 text-right">Remaining</th>
            <th className="w-28 py-2 pl-2">Qty (MT)</th>
            <th className="w-36 py-2 pl-2">Price / MT ({currency})</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.salesOrderLineId} className="border-t border-line">
              <td className="py-2">
                <span className="font-medium">{l.description}</span>
                <span className="block text-xs text-muted">
                  {l.salesOrder.name} / {l.lineNo} · {l.customer.name} · sold at{' '}
                  {money(l.unitPrice, l.currency)}/{l.uom}
                </span>
              </td>
              <td className="num py-2">{mt(l.remainingQtyBase)}</td>
              <td className="py-2 pl-2">
                <Input
                  aria-label={`Quantity for ${l.salesOrder.name} line ${l.lineNo}`}
                  inputMode="decimal"
                  value={l.qty}
                  onChange={(e) =>
                    setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))
                  }
                  className="h-8 text-right"
                />
              </td>
              <td className="py-2 pl-2">
                <Input
                  aria-label={`Price for ${l.salesOrder.name} line ${l.lineNo}`}
                  inputMode="decimal"
                  value={l.price}
                  onChange={(e) =>
                    setLines(lines.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))
                  }
                  className="h-8 text-right"
                />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line">
            <td colSpan={3} className="py-2 text-right font-medium">
              PO total
            </td>
            <td className="num py-2 font-semibold">{money(total, currency)}</td>
          </tr>
        </tfoot>
      </table>
      <ErrorBox error={error} className="mt-3" />
    </Dialog>
  );
}

function AwaitingInner() {
  const { can } = useAuth();
  const [state, set] = useUrlState();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const query = useQuery({
    queryKey: ['awaiting', state.q ?? ''],
    queryFn: () => api.get<AwaitingPurchaseItemDto[]>('/sales-orders/awaiting-purchase', { q: state.q }),
  });
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const chosen = rows.filter((r) => selected.has(r.salesOrderLineId));
  const totalKg = rows.reduce((a, r) => a + Number(r.remainingQtyBase), 0);
  const toggle = (id: string) =>
    setSelected((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));

  return (
    <>
      <PageHeader
        breadcrumb={{ label: 'Purchase orders', href: '/purchases' }}
        title="Awaiting purchase"
        subtitle={`Confirmed customer order lines not yet bought from a supplier · ${rows.length} lines · ${mt(totalKg)}`}
        actions={
          can('purchase_order.manage') && (
            <Button variant="primary" disabled={chosen.length === 0} onClick={() => setCreating(true)}>
              <ShoppingBag className="h-4 w-4" /> Create PO for {chosen.length || ''} selected
            </Button>
          )
        }
      />
      <Card>
        <Toolbar>
          <SearchInput
            value={state.q ?? ''}
            onChange={(q) => set({ q })}
            placeholder="Order, customer, product…"
          />
          <div className="ml-auto">
            <ExportButton endpoint="/sales-orders/awaiting-purchase" query={{ q: state.q }} />
          </div>
        </Toolbar>
        {query.error ? (
          <ErrorBox error={query.error} className="m-3" />
        ) : !query.data ? (
          <Loading />
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">
            Everything confirmed has been purchased. 🎉
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-slate-50/80 text-left text-xs text-muted uppercase">
                  <th className="px-3 py-2" />
                  <th className="px-3 py-2">Order</th>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2 text-right">Ordered</th>
                  <th className="px-3 py-2 text-right">Remaining</th>
                  <th className="px-3 py-2">Ship by</th>
                  <th className="px-3 py-2 text-right">Waiting</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.salesOrderLineId} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">
                      {can('purchase_order.manage') && (
                        <input
                          type="checkbox"
                          aria-label={`Select ${r.salesOrder.name} line ${r.lineNo}`}
                          checked={selected.has(r.salesOrderLineId)}
                          onChange={() => toggle(r.salesOrderLineId)}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link
                        href={`/sales-orders/${r.salesOrder.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {r.salesOrder.name}
                      </Link>{' '}
                      <span className="text-muted">/ {r.lineNo}</span>
                    </td>
                    <td className="px-3 py-2">{r.customer.name}</td>
                    <td className="px-3 py-2">{r.description}</td>
                    <td className="num px-3 py-2">{mt(r.orderedQtyBase)}</td>
                    <td className="num px-3 py-2 font-medium">{mt(r.remainingQtyBase)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{date(r.requestedShipmentDate)}</td>
                    <td className="px-3 py-2 text-right">
                      <Badge
                        tone={
                          r.daysSinceConfirmation > 7
                            ? 'overdue'
                            : r.daysSinceConfirmation > 3
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {r.daysSinceConfirmation} d
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <CreatePoDialog rows={chosen} open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

export default function AwaitingPurchasePage() {
  return (
    <Suspense fallback={<Loading />}>
      <AwaitingInner />
    </Suspense>
  );
}
