'use client';

import type { DashboardDto } from '@fillco/contracts';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardBody, CardHeader, Stat } from '@/components/ui/card';
import { ErrorBox, Loading, PageHeader } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { money, monthLabel } from '@/lib/format';

const compact = (v: number) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v);

function SalesChart({ data, currency }: { data: DashboardDto['salesByMonth']; currency: string }) {
  const rows = data.map((d) => ({ month: monthLabel(d.month), value: Number(d.valueBase) }));
  return (
    <div className="h-64" role="img" aria-label={`Confirmed sales per month in ${currency}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={48}
            tick={{ fontSize: 11, fill: '#64748b' }}
            tickFormatter={compact}
          />
          <Tooltip
            cursor={{ fill: '#eef4ff' }}
            formatter={(v) => [money(Number(v), currency, 0), 'Confirmed sales']}
            contentStyle={{ borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12 }}
            itemStyle={{ color: '#0f172a' }}
          />
          <Bar dataKey="value" fill="#2657c9" radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function DashboardPage() {
  const { me, can } = useAuth();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardDto>('/dashboard') });
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <Loading />;
  const d = q.data;
  const c = d.baseCurrency;
  return (
    <>
      <PageHeader
        title={`Good day, ${me?.fullName.split(' ')[0]}`}
        subtitle={`All values in ${c}. Shipments, receivables and cash flow join the dashboard in later phases.`}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {can('sales_order.view') && (
          <>
            <Stat
              label="Open sales orders"
              value={money(d.openSalesOrders.valueBase, c, 0)}
              hint={`${d.openSalesOrders.count} confirmed / on hold`}
              href="/sales-orders?status=CONFIRMED%2CON_HOLD"
            />
            <Stat
              label="Awaiting confirmation"
              value={money(d.pendingConfirmation.valueBase, c, 0)}
              hint={`${d.pendingConfirmation.count} draft / pending`}
              href="/sales-orders?status=DRAFT%2CPENDING_CONFIRMATION"
            />
            <Stat
              label="Not yet purchased"
              value={`${d.awaitingPurchase.orders} orders`}
              hint={`${d.awaitingPurchase.lines} lines waiting for a supplier`}
              tone={d.awaitingPurchase.orders ? 'warning' : 'good'}
              href="/purchases/awaiting"
            />
            <Stat
              label="Sales this month"
              value={money(d.salesThisMonthBase, c, 0)}
              hint={`Year to date ${money(d.salesThisYearBase, c, 0)}`}
            />
          </>
        )}
        {can('purchase_order.view') && (
          <>
            <Stat
              label="Open purchase orders"
              value={
                d.openPurchaseOrders.valueBase
                  ? money(d.openPurchaseOrders.valueBase, c, 0)
                  : d.openPurchaseOrders.count
              }
              hint={`${d.openPurchaseOrders.count} POs`}
              href="/purchases?status=DRAFT%2CSENT%2CCONFIRMED%2CIN_PRODUCTION%2CREADY"
            />
            <Stat
              label="Delayed purchase orders"
              value={d.delayedPurchaseOrders}
              hint="Past their ready date"
              tone={d.delayedPurchaseOrders ? 'critical' : 'good'}
              href="/purchases?delayed=true"
            />
            {d.purchasesThisMonthBase !== null && (
              <Stat
                label="Purchases this month"
                value={money(d.purchasesThisMonthBase, c, 0)}
                hint={`Year to date ${money(d.purchasesThisYearBase, c, 0)}`}
              />
            )}
          </>
        )}
        {can('quotation.view') && (
          <Stat
            label="Open quotations"
            value={d.quotationsOpen}
            hint={`${d.quotationsExpiringSoon} expiring within 7 days`}
            tone={d.quotationsExpiringSoon ? 'warning' : 'neutral'}
            href="/quotations"
          />
        )}
        {can('supplier_bank.approve') && d.bankAccountsPendingApproval > 0 && (
          <Stat
            label="Bank details to approve"
            value={d.bankAccountsPendingApproval}
            hint="Four-eyes approval needed before payment"
            tone="warning"
            href="/suppliers"
          />
        )}
      </div>
      {can('sales_order.view') && (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Confirmed sales per month" subtitle={`Last 12 months, ${c}`} />
            <CardBody>
              <SalesChart data={d.salesByMonth} currency={c} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Top customers this year" />
            {d.topCustomers.length === 0 ? (
              <p className="p-4 text-sm text-muted">No confirmed sales this year yet.</p>
            ) : (
              <ol className="divide-y divide-line">
                {d.topCustomers.map((t, i) => {
                  const max = Number(d.topCustomers[0]!.valueBase) || 1;
                  return (
                    <li key={t.customer.id} className="px-4 py-2.5">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <Link
                          href={`/customers/${t.customer.id}`}
                          className="truncate text-ink hover:text-brand-700"
                        >
                          {i + 1}. {t.customer.name}
                        </Link>
                        <span className="tabular-nums">{money(t.valueBase, c, 0)}</span>
                      </div>
                      <div className="mt-1 h-1 rounded-full bg-slate-100">
                        <div
                          className="h-1 rounded-full bg-brand-500"
                          style={{ width: `${(Number(t.valueBase) / max) * 100}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
