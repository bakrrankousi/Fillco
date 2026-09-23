import { Injectable } from '@nestjs/common';
import type { DashboardDto } from '@fillco/contracts';
import { Prisma } from '@fillco/db';
import { addDays, deriveSalesOrderStatus, isoToDate, sum } from '@fillco/domain';
import { Actor, can } from '../../common/actor';
import { CompanyService } from '../../common/company.service';
import { PrismaService } from '../../common/prisma.service';
import { canSeeCosts, viaCustomerScope } from '../../common/scope';
import { refReq } from '../../common/serialize';
import { loadFulfillment } from '../sales/fulfillment';

/** Phase 1 dashboard: order pipeline and purchasing. Receivables, shipments and cash arrive in later phases. */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly company: CompanyService,
  ) {}

  async get(actor: Actor): Promise<DashboardDto> {
    const company = await this.company.get(actor.companyId);
    const today = this.company.today(company);
    const monthStart = `${today.slice(0, 7)}-01`;
    const yearStart = `${today.slice(0, 4)}-01-01`;
    const soScope: Prisma.SalesOrderWhereInput = { companyId: actor.companyId, ...viaCustomerScope(actor) };
    const showSales = can(actor, 'sales_order.view');
    const showPurchases = can(actor, 'purchase_order.view');
    const showCosts = canSeeCosts(actor);

    const sumBase = (rows: { grandTotalBase: Prisma.Decimal }[]) =>
      sum(rows.map((r) => r.grandTotalBase.toFixed())).toFixed(2);

    const [open, pending, monthSales, yearSales] = showSales
      ? await Promise.all([
          this.prisma.salesOrder.findMany({
            where: { ...soScope, status: { in: ['CONFIRMED', 'ON_HOLD'] } },
            select: { id: true, status: true, grandTotalBase: true },
          }),
          this.prisma.salesOrder.findMany({
            where: { ...soScope, status: { in: ['DRAFT', 'PENDING_CONFIRMATION'] } },
            select: { grandTotalBase: true },
          }),
          this.prisma.salesOrder.findMany({
            where: {
              ...soScope,
              status: { in: ['CONFIRMED', 'ON_HOLD', 'CLOSED'] },
              orderDate: { gte: isoToDate(monthStart) },
            },
            select: { grandTotalBase: true },
          }),
          this.prisma.salesOrder.findMany({
            where: {
              ...soScope,
              status: { in: ['CONFIRMED', 'ON_HOLD', 'CLOSED'] },
              orderDate: { gte: isoToDate(yearStart) },
            },
            select: { grandTotalBase: true, orderDate: true, customerId: true },
          }),
        ])
      : [[], [], [], []];

    const progress = await loadFulfillment(
      this.prisma,
      open.map((o) => o.id),
    );
    let awaitingLines = 0;
    let awaitingOrders = 0;
    for (const o of open) {
      if (o.status !== 'CONFIRMED') continue;
      const d = deriveSalesOrderStatus('CONFIRMED', progress.get(o.id) ?? []);
      const lines = (progress.get(o.id) ?? []).filter(
        (l) =>
          l.lineStatus === 'OPEN' &&
          Number(l.ordered) > Number(l.purchasedCommitted) + Number(l.purchasedPending),
      );
      if (d.remainingToPurchase.gt(0)) {
        awaitingOrders++;
        awaitingLines += lines.length;
      }
    }

    const poScope: Prisma.PurchaseOrderWhereInput = { companyId: actor.companyId };
    const [openPos, delayed, monthPurch, yearPurch] = showPurchases
      ? await Promise.all([
          this.prisma.purchaseOrder.findMany({
            where: { ...poScope, status: { in: ['DRAFT', 'SENT', 'CONFIRMED', 'IN_PRODUCTION', 'READY'] } },
            select: { grandTotalBase: true },
          }),
          this.prisma.purchaseOrder.count({
            where: {
              ...poScope,
              status: { in: ['CONFIRMED', 'IN_PRODUCTION'] },
              OR: [
                { confirmedReadyDate: { lt: isoToDate(today) } },
                { confirmedReadyDate: null, expectedReadyDate: { lt: isoToDate(today) } },
              ],
            },
          }),
          this.prisma.purchaseOrder.findMany({
            where: {
              ...poScope,
              status: { in: ['CONFIRMED', 'IN_PRODUCTION', 'READY', 'CLOSED'] },
              poDate: { gte: isoToDate(monthStart) },
            },
            select: { grandTotalBase: true },
          }),
          this.prisma.purchaseOrder.findMany({
            where: {
              ...poScope,
              status: { in: ['CONFIRMED', 'IN_PRODUCTION', 'READY', 'CLOSED'] },
              poDate: { gte: isoToDate(yearStart) },
            },
            select: { grandTotalBase: true },
          }),
        ])
      : [[], 0, [], []];

    const [quotationsOpen, quotationsExpiringSoon] = can(actor, 'quotation.view')
      ? await Promise.all([
          this.prisma.quotation.count({
            where: {
              companyId: actor.companyId,
              ...viaCustomerScope(actor),
              status: { in: ['DRAFT', 'SENT'] },
            },
          }),
          this.prisma.quotation.count({
            where: {
              companyId: actor.companyId,
              ...viaCustomerScope(actor),
              status: 'SENT',
              validUntil: { gte: isoToDate(today), lte: isoToDate(addDays(today, 7)) },
            },
          }),
        ])
      : [0, 0];

    const pendingBank = can(actor, 'supplier_bank.approve')
      ? await this.prisma.supplierBankAccount.count({
          where: { status: 'PENDING_APPROVAL', supplier: { companyId: actor.companyId } },
        })
      : 0;

    // Monthly sales for the last 12 months (confirmed orders, base currency).
    const since = addDays(`${today.slice(0, 7)}-01`, -335).slice(0, 7) + '-01';
    const history = showSales
      ? await this.prisma.salesOrder.findMany({
          where: {
            ...soScope,
            status: { in: ['CONFIRMED', 'ON_HOLD', 'CLOSED'] },
            orderDate: { gte: isoToDate(since) },
          },
          select: { orderDate: true, grandTotalBase: true },
        })
      : [];
    const months: string[] = [];
    for (let d = since; months.length < 12;) {
      months.push(d.slice(0, 7));
      const [y, m] = d.split('-').map(Number) as [number, number];
      d = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    }
    const byMonth = new Map(months.map((m) => [m, [] as string[]]));
    for (const h of history)
      byMonth.get(h.orderDate.toISOString().slice(0, 7))?.push(h.grandTotalBase.toFixed());

    const byCustomer = new Map<string, string[]>();
    for (const s of yearSales)
      byCustomer.set(s.customerId, [...(byCustomer.get(s.customerId) ?? []), s.grandTotalBase.toFixed()]);
    const top = [...byCustomer.entries()]
      .map(([id, values]) => ({ id, total: sum(values) }))
      .sort((a, b) => b.total.comparedTo(a.total))
      .slice(0, 5);
    const customers = new Map(
      (await this.prisma.customer.findMany({ where: { id: { in: top.map((t) => t.id) } } })).map((c) => [
        c.id,
        c,
      ]),
    );

    return {
      baseCurrency: company.baseCurrency,
      openSalesOrders: { count: open.length, valueBase: sumBase(open) },
      pendingConfirmation: { count: pending.length, valueBase: sumBase(pending) },
      awaitingPurchase: { lines: awaitingLines, orders: awaitingOrders },
      openPurchaseOrders: { count: openPos.length, valueBase: showCosts ? sumBase(openPos) : null },
      delayedPurchaseOrders: delayed,
      salesThisMonthBase: sumBase(monthSales),
      salesThisYearBase: sumBase(yearSales),
      purchasesThisMonthBase: showCosts ? sumBase(monthPurch) : null,
      purchasesThisYearBase: showCosts ? sumBase(yearPurch) : null,
      quotationsOpen,
      quotationsExpiringSoon,
      bankAccountsPendingApproval: pendingBank,
      salesByMonth: months.map((m) => ({ month: m, valueBase: sum(byMonth.get(m) ?? []).toFixed(2) })),
      topCustomers: top.map((t) => ({
        customer: refReq(customers.get(t.id)!),
        valueBase: t.total.toFixed(2),
      })),
    };
  }
}
