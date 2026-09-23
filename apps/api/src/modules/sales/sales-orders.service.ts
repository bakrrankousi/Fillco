import { Injectable } from '@nestjs/common';
import type {
  ActivityEventDto,
  AllocationDto,
  AwaitingPurchaseItemDto,
  ConfirmSalesOrderInput,
  CreditCheckDto,
  CreditPreviewDto,
  ListQuery,
  Page,
  SalesOrderDto,
  SalesOrderInput,
  SalesOrderLineDto,
  SalesOrderListItemDto,
  UpdateSalesOrderInput,
} from '@fillco/contracts';
import { Prisma } from '@fillco/db';
import {
  addDays,
  buildInstallmentSchedule,
  CreditEvaluation,
  dec,
  Decimal,
  deriveSalesOrderStatus,
  diffDays,
  EventDates,
  isoToDate,
  roundMoney,
  soLineProgress,
  sum,
  toBase,
  yearOf,
} from '@fillco/domain';
import { Actor, can } from '../../common/actor';
import { AuditService } from '../../common/audit.service';
import { CompanyService } from '../../common/company.service';
import { assertVersion, BusinessRuleError, ForbiddenError, NotFoundError } from '../../common/errors';
import { FxService } from '../../common/fx.service';
import { contains, orderBy, page, paging } from '../../common/list';
import { PrismaService, Tx } from '../../common/prisma.service';
import { canSeeCosts, viaCustomerScope } from '../../common/scope';
import { SequenceService } from '../../common/sequence.service';
import { day, dayReq, ref, refReq, ts, tsReq } from '../../common/serialize';
import { DocumentLinesService, PreparedLine } from '../catalog/document-lines.service';
import { addressDto } from '../parties/party-mappers';
import { CreditService } from '../parties/credit.service';
import { CustomersService } from '../parties/customers.service';
import { termSummary } from '../settings/settings.service';
import { loadFulfillment } from './fulfillment';

/** Rough sea transit used only to estimate ETA-based due dates until shipments exist. */
export const DEFAULT_TRANSIT_DAYS = 30;

const termInclude = { installments: { orderBy: { seq: 'asc' } } } satisfies Prisma.PaymentTermInclude;

const allocationInclude = {
  purchaseOrderLine: { include: { purchaseOrder: { include: { supplier: true } } } },
} satisfies Prisma.OrderAllocationInclude;

const include = {
  customer: true,
  quotation: true,
  salesperson: true,
  paymentTerm: { include: termInclude },
  shippingAddress: true,
  billingAddress: true,
  lines: {
    include: { variant: { include: { product: true } }, allocations: { include: allocationInclude } },
    orderBy: { lineNo: 'asc' },
  },
  paymentSchedule: { orderBy: { seq: 'asc' } },
  creditChecks: { include: { override: { include: { approvedBy: true } } }, orderBy: { evaluatedAt: 'desc' } },
} satisfies Prisma.SalesOrderInclude;
type SalesOrderRow = Prisma.SalesOrderGetPayload<{ include: typeof include }>;

export interface SalesOrderFilter extends ListQuery {
  status?: string;
  customerId?: string;
  salespersonId?: string;
  from?: string;
  to?: string;
}

const EDITABLE = new Set(['DRAFT', 'PENDING_CONFIRMATION']);

/** Planned dates used for estimated due dates before the real events happen. */
export function estimatedEvents(plannedShipment: string | null, orderDate: string): EventDates {
  const ship = plannedShipment ?? addDays(orderDate, 30);
  const eta = addDays(ship, DEFAULT_TRANSIT_DAYS);
  return {
    BEFORE_LOADING: ship,
    BL_DATE: ship,
    INVOICE_DATE: ship,
    ETA: eta,
    ARRIVAL: eta,
    DELIVERY: addDays(eta, 7),
  };
}

/** Share of the order payable before the goods leave, which does not consume credit. */
export function securedPercent(installments: { percent: Prisma.Decimal; triggerEvent: string }[]): Decimal {
  return sum(
    installments
      .filter((i) => i.triggerEvent === 'ORDER_CONFIRMATION' || i.triggerEvent === 'BEFORE_LOADING')
      .map((i) => i.percent.toFixed()),
  );
}

@Injectable()
export class SalesOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
    private readonly company: CompanyService,
    private readonly fx: FxService,
    private readonly lines: DocumentLinesService,
    private readonly customers: CustomersService,
    private readonly credit: CreditService,
  ) {}

  // ───────────── Reading ─────────────

  private allocationDto(
    actor: Actor,
    a: SalesOrderRow['lines'][number]['allocations'][number],
    so: { id: string; number: string; customer: { id: string; companyName: string; code: string } },
    soLine: { lineNo: number; description: string },
  ): AllocationDto {
    const pl = a.purchaseOrderLine;
    const po = pl.purchaseOrder;
    return {
      id: a.id,
      salesOrderLineId: a.salesOrderLineId,
      purchaseOrderLineId: a.purchaseOrderLineId,
      salesOrder: { id: so.id, code: so.number, name: so.number },
      purchaseOrder: { id: po.id, code: po.number, name: po.number },
      customer: refReq(so.customer),
      supplier: refReq(po.supplier),
      poStatus: po.status,
      soLineNo: soLine.lineNo,
      poLineNo: pl.lineNo,
      description: soLine.description,
      qtyBase: a.qtyBase.toFixed(),
      isSubstitute: a.isSubstitute,
      substituteNote: a.substituteNote,
      unitCostBase: canSeeCosts(actor) && !pl.qtyBase.isZero() ? pl.lineTotal.div(pl.qtyBase).toDecimalPlaces(6).toFixed() : null,
      poCurrency: po.currency,
      createdAt: tsReq(a.createdAt),
    };
  }

  private async timeline(so: SalesOrderRow): Promise<ActivityEventDto[]> {
    const poIds = [...new Set(so.lines.flatMap((l) => l.allocations.map((a) => a.purchaseOrderLine.purchaseOrderId)))];
    const events = await this.prisma.activityEvent.findMany({
      where: {
        OR: [
          { salesOrderId: so.id },
          ...(so.quotationId ? [{ quotationId: so.quotationId, salesOrderId: null }] : []),
          ...(poIds.length ? [{ purchaseOrderId: { in: poIds }, salesOrderId: null }] : []),
        ],
      },
      orderBy: { occurredAt: 'asc' },
      take: 200,
    });
    const users = new Map(
      (await this.prisma.user.findMany({ where: { id: { in: events.map((e) => e.userId).filter((x): x is string => !!x) } } })).map((u) => [u.id, u]),
    );
    return events.map((e) => ({
      id: e.id,
      occurredAt: tsReq(e.occurredAt),
      eventType: e.eventType,
      entityType: e.entityType,
      entityId: e.entityId,
      summary: e.summary,
      user: ref(e.userId ? users.get(e.userId) : null),
    }));
  }

  private creditCheckDto(c: SalesOrderRow['creditChecks'][number], users: Map<string, { id: string; fullName: string }>): CreditCheckDto {
    return {
      id: c.id,
      evaluatedAt: tsReq(c.evaluatedAt),
      evaluatedBy: ref(c.evaluatedById ? users.get(c.evaluatedById) : null),
      currency: c.currency,
      creditLimit: c.creditLimit.toFixed(2),
      openAr: c.openAr.toFixed(2),
      overdueAmount: c.overdueAmount.toFixed(2),
      openOrders: c.openOrders.toFixed(2),
      unappliedCredit: c.unappliedCredit.toFixed(2),
      exposure: c.exposure.toFixed(2),
      newOrderValue: c.newOrderValue.toFixed(2),
      newOrderUnsecured: c.newOrderUnsecured.toFixed(2),
      availableAfter: c.availableAfter.toFixed(2),
      excess: c.excess.toFixed(2),
      result: c.result,
      reasons: c.reasons as string[],
      override: c.override
        ? { approvedBy: refReq(c.override.approvedBy), approvedAt: tsReq(c.override.approvedAt), reason: c.override.reason }
        : null,
    };
  }

  private async toDto(actor: Actor, so: SalesOrderRow): Promise<SalesOrderDto> {
    const company = await this.company.get(actor.companyId);
    const packaging = await DocumentLinesService.packagingMap(this.prisma);
    const portIds = [so.loadingPortId, so.destinationPortId].filter((x): x is string => !!x);
    const ports = new Map((await this.prisma.port.findMany({ where: { id: { in: portIds } } })).map((p) => [p.id, p]));
    const fulfillment = (await loadFulfillment(this.prisma, [so.id])).get(so.id) ?? [];
    const derived = deriveSalesOrderStatus(so.status, fulfillment);
    const byLine = new Map(fulfillment.map((f) => [f.salesOrderLineId, soLineProgress(f)]));
    const showCost = canSeeCosts(actor);

    const lines: SalesOrderLineDto[] = so.lines.map((l) => {
      const p = byLine.get(l.id);
      return {
        ...DocumentLinesService.toDto(l, packaging),
        tolerancePct: l.tolerancePct.toFixed(),
        lineStatus: l.lineStatus,
        closedReason: l.closedReason,
        purchasedQtyBase: p?.purchased.toFixed() ?? '0',
        purchasedCommittedQtyBase: p?.purchasedCommitted.toFixed() ?? '0',
        remainingToPurchaseBase: p?.remainingToPurchase.toFixed() ?? '0',
        shippedQtyBase: p?.shipped.toFixed() ?? '0',
        remainingToShipBase: p?.remainingToShip.toFixed() ?? '0',
        allocations: l.allocations.map((a) => this.allocationDto(actor, a, so, l)),
      };
    });

    // Finance summary: committed cost of purchased quantities vs their sales value (base currency).
    let purchasedSalesBase = new Decimal(0);
    let purchaseCostBase = new Decimal(0);
    for (const l of so.lines) {
      if (l.lineStatus === 'CANCELLED' || l.qtyBase.isZero()) continue;
      const salesPerKg = dec(l.lineTotal.toFixed()).div(l.qtyBase.toFixed());
      for (const a of l.allocations) {
        const pl = a.purchaseOrderLine;
        if (pl.purchaseOrder.status === 'CANCELLED' || pl.qtyBase.isZero()) continue;
        const qty = dec(a.qtyBase.toFixed());
        purchasedSalesBase = purchasedSalesBase.plus(qty.times(salesPerKg).times(so.fxRate.toFixed()));
        purchaseCostBase = purchaseCostBase.plus(
          qty.times(dec(pl.lineTotal.toFixed()).div(pl.qtyBase.toFixed())).times(pl.purchaseOrder.fxRate.toFixed()),
        );
      }
    }
    const profit = roundMoney(purchasedSalesBase.minus(purchaseCostBase), company.baseMinorUnits);
    const salesValueBase = toBase(sum(so.lines.filter((l) => l.lineStatus !== 'CANCELLED').map((l) => l.lineTotal.toFixed())), so.fxRate.toFixed(), company.baseMinorUnits);

    const purchaseOrders = new Map<string, SalesOrderDto['purchaseOrders'][number]>();
    for (const l of so.lines)
      for (const a of l.allocations) {
        const po = a.purchaseOrderLine.purchaseOrder;
        purchaseOrders.set(po.id, {
          id: po.id,
          code: po.number,
          name: po.number,
          supplier: refReq(po.supplier),
          status: po.status,
          expectedReadyDate: day(po.confirmedReadyDate ?? po.expectedReadyDate),
        });
      }

    const userIds = so.creditChecks.map((c) => c.evaluatedById).filter((x): x is string => !!x);
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: userIds } } })).map((u) => [u.id, u]));

    return {
      id: so.id,
      number: so.number,
      customer: refReq(so.customer),
      customerStatus: so.customer.status,
      quotation: so.quotation ? { id: so.quotation.id, code: so.quotation.number, name: `${so.quotation.number} rev ${so.quotation.revision}` } : null,
      customerPoRef: so.customerPoRef,
      orderDate: dayReq(so.orderDate),
      salesperson: ref(so.salesperson),
      currency: so.currency,
      fxRate: so.fxRate.toFixed(),
      incoterm: so.incoterm,
      loadingPort: ref(so.loadingPortId ? ports.get(so.loadingPortId) : null),
      destinationCountry: so.destinationCountry,
      destinationPort: ref(so.destinationPortId ? ports.get(so.destinationPortId) : null),
      shippingAddress: so.shippingAddress ? addressDto(so.shippingAddress) : null,
      billingAddress: so.billingAddress ? addressDto(so.billingAddress) : null,
      paymentTerm: ref(so.paymentTerm),
      paymentTermSummary: so.paymentTerm ? termSummary(so.paymentTerm) : null,
      requestedShipmentDate: day(so.requestedShipmentDate),
      status: so.status,
      displayStatus: derived.display,
      purchasing: derived.purchasing,
      shipping: derived.shipping,
      purchasedPct: derived.purchasedPct.toFixed(),
      shippedPct: derived.shippedPct.toFixed(),
      confirmedAt: ts(so.confirmedAt),
      cancelledAt: ts(so.cancelledAt),
      cancelReason: so.cancelReason,
      notes: so.notes,
      internalNotes: so.internalNotes,
      subtotal: so.subtotal.toFixed(),
      discountTotal: so.discountTotal.toFixed(),
      grandTotal: so.grandTotal.toFixed(),
      grandTotalBase: so.grandTotalBase.toFixed(),
      lines,
      paymentSchedule: so.paymentSchedule.map((s) => ({
        seq: s.seq,
        percent: s.percent.toFixed(),
        amount: s.amount.toFixed(),
        triggerEvent: s.triggerEvent,
        offsetDays: s.offsetDays,
        instrument: s.instrument,
        dueDate: day(s.dueDate),
        estimatedDueDate: day(s.estimatedDueDate),
        dueStatus: s.dueStatus,
      })),
      creditChecks: so.creditChecks.map((c) => this.creditCheckDto(c, users)),
      finance: {
        currency: so.currency,
        salesValue: so.grandTotal.toFixed(),
        salesValueBase: salesValueBase.toFixed(),
        baseCurrency: company.baseCurrency,
        purchaseCostBase: showCost ? roundMoney(purchaseCostBase, company.baseMinorUnits).toFixed() : null,
        estimatedGrossProfitBase: showCost ? profit.toFixed() : null,
        estimatedMarginPct:
          showCost && !purchasedSalesBase.isZero() ? profit.div(purchasedSalesBase).times(100).toDecimalPlaces(1).toFixed() : null,
        costCoveragePct: derived.purchasedPct.toFixed(),
      },
      purchaseOrders: [...purchaseOrders.values()],
      timeline: await this.timeline(so),
      createdAt: tsReq(so.createdAt),
      version: so.version,
    };
  }

  async list(actor: Actor, q: SalesOrderFilter): Promise<{ page: Page<SalesOrderListItemDto>; rows: SalesOrderListItemDto[] }> {
    const where: Prisma.SalesOrderWhereInput = {
      companyId: actor.companyId,
      ...viaCustomerScope(actor),
      ...(q.status
        ? { status: { in: q.status.split(',') as Prisma.EnumSalesOrderStatusFilter['in'] } }
        : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.salespersonId ? { salespersonId: q.salespersonId } : {}),
      ...(q.from || q.to
        ? { orderDate: { ...(q.from ? { gte: isoToDate(q.from) } : {}), ...(q.to ? { lte: isoToDate(q.to) } : {}) } }
        : {}),
      ...(q.q
        ? {
            OR: [
              { number: contains(q.q) },
              { customerPoRef: contains(q.q) },
              { customer: { companyName: contains(q.q) } },
              { lines: { some: { description: contains(q.q) } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.salesOrder.findMany({
        where,
        include: { customer: true, salesperson: true },
        orderBy: orderBy(
          q.sort,
          {
            number: (dir) => ({ number: dir }),
            orderDate: (dir) => ({ orderDate: dir }),
            grandTotalBase: (dir) => ({ grandTotalBase: dir }),
            status: (dir) => ({ status: dir }),
            customer: (dir) => ({ customer: { companyName: dir } }),
            requestedShipmentDate: (dir) => ({ requestedShipmentDate: dir }),
          },
          { createdAt: 'desc' },
        ) as Prisma.SalesOrderOrderByWithRelationInput[],
        ...paging(q),
      }),
      this.prisma.salesOrder.count({ where }),
    ]);
    const progress = await loadFulfillment(this.prisma, rows.map((r) => r.id));
    const items: SalesOrderListItemDto[] = rows.map((r) => {
      const derived = deriveSalesOrderStatus(r.status, progress.get(r.id) ?? []);
      return {
        id: r.id,
        number: r.number,
        customer: refReq(r.customer),
        customerCountry: r.customer.countryCode,
        customerPoRef: r.customerPoRef,
        orderDate: dayReq(r.orderDate),
        currency: r.currency,
        grandTotal: r.grandTotal.toFixed(),
        grandTotalBase: r.grandTotalBase.toFixed(),
        status: r.status,
        displayStatus: derived.display,
        purchasedPct: derived.purchasedPct.toFixed(),
        shippedPct: derived.shippedPct.toFixed(),
        salesperson: r.salesperson?.fullName ?? null,
        destinationCountry: r.destinationCountry,
        requestedShipmentDate: day(r.requestedShipmentDate),
      };
    });
    return { page: page(items, total, q), rows: items };
  }

  async find(actor: Actor, id: string, tx: Tx = this.prisma): Promise<SalesOrderRow> {
    const so = await tx.salesOrder.findFirst({ where: { id, companyId: actor.companyId, ...viaCustomerScope(actor) }, include });
    if (!so) throw new NotFoundError('Sales order', id);
    return so;
  }

  async get(actor: Actor, id: string): Promise<SalesOrderDto> {
    return this.toDto(actor, await this.find(actor, id));
  }

  // ───────────── Writing drafts ─────────────

  private async header(tx: Tx, actor: Actor, input: SalesOrderInput) {
    const customer = await this.customers.findVisible(actor, input.customerId, tx);
    if (customer.status === 'INACTIVE') throw new BusinessRuleError('This customer is archived. Reactivate it first.');
    for (const addressId of [input.shippingAddressId, input.billingAddressId]) {
      if (addressId && !customer.addresses.some((a) => a.id === addressId)) {
        throw new BusinessRuleError('Address does not belong to this customer');
      }
    }
    const company = await this.company.get(actor.companyId, tx);
    const fxRate = await this.fx.rate(input.currency, company.baseCurrency, input.orderDate, tx);
    return {
      company,
      data: {
        customerId: input.customerId,
        customerPoRef: input.customerPoRef ?? null,
        orderDate: isoToDate(input.orderDate),
        salespersonId: input.salespersonId ?? customer.salespersonId ?? actor.userId,
        currency: input.currency,
        fxRate: fxRate.toFixed(),
        incoterm: input.incoterm ?? null,
        loadingPortId: input.loadingPortId ?? null,
        destinationCountry: input.destinationCountry ?? customer.countryCode,
        destinationPortId: input.destinationPortId ?? null,
        shippingAddressId: input.shippingAddressId ?? null,
        billingAddressId: input.billingAddressId ?? null,
        paymentTermId: input.paymentTermId ?? customer.paymentTermId ?? null,
        requestedShipmentDate: input.requestedShipmentDate ? isoToDate(input.requestedShipmentDate) : null,
        notes: input.notes ?? null,
        internalNotes: input.internalNotes ?? null,
      },
      fxRate,
    };
  }

  private lineData(prepared: PreparedLine[], input: SalesOrderInput, defaultTolerance: string) {
    return prepared.map((l, i) => ({
      lineNo: l.lineNo,
      variantId: l.variantId,
      description: l.description,
      specSnapshot: l.specSnapshot,
      packagingTypeId: l.packagingTypeId,
      qty: l.qty,
      uom: l.uom,
      qtyBase: l.qtyBase,
      unitPrice: l.unitPrice,
      discountPct: l.discountPct,
      lineTotal: l.lineTotal,
      tolerancePct: input.lines[i]?.tolerancePct ?? defaultTolerance,
      notes: l.notes,
    }));
  }

  async create(actor: Actor, input: SalesOrderInput): Promise<SalesOrderDto> {
    const so = await this.prisma.tx(async (tx) => {
      const { company, data, fxRate } = await this.header(tx, actor, input);
      const doc = await this.lines.prepare(tx, input.currency, input.lines);
      const number = await this.sequences.next(tx, actor.companyId, 'SO', yearOf(input.orderDate));
      const created = await tx.salesOrder.create({
        data: {
          ...data,
          companyId: actor.companyId,
          number,
          subtotal: doc.totals.subtotal.toFixed(),
          discountTotal: doc.totals.discountTotal.toFixed(),
          grandTotal: doc.totals.grandTotal.toFixed(),
          grandTotalBase: toBase(doc.totals.grandTotal, fxRate, company.baseMinorUnits).toFixed(),
          createdById: actor.userId,
          updatedById: actor.userId,
          lines: { create: this.lineData(doc.lines, input, company.defaultTolerancePct) },
        },
        include,
      });
      await this.audit.log(tx, actor, { entityType: 'sales_order', entityId: created.id, action: 'create', after: created });
      await this.audit.activity(tx, actor, {
        eventType: 'sales_order.created',
        entityType: 'sales_order',
        entityId: created.id,
        salesOrderId: created.id,
        customerId: created.customerId,
        summary: `Sales order ${created.number} created (${created.currency} ${created.grandTotal.toFixed(2)})`,
      });
      return created;
    });
    return this.toDto(actor, so);
  }

  /** Used by quotation conversion inside its transaction. */
  async createFromQuotation(
    tx: Tx,
    actor: Actor,
    q: Prisma.QuotationGetPayload<{ include: { lines: true } }>,
  ): Promise<{ id: string; number: string }> {
    const company = await this.company.get(actor.companyId, tx);
    const today = this.company.today(company);
    const customer = await this.customers.findVisible(actor, q.customerId, tx);
    const fxRate = await this.fx.rate(q.currency, company.baseCurrency, today, tx);
    const number = await this.sequences.next(tx, actor.companyId, 'SO', yearOf(today));
    const so = await tx.salesOrder.create({
      data: {
        companyId: actor.companyId,
        number,
        customerId: q.customerId,
        quotationId: q.id,
        orderDate: isoToDate(today),
        salespersonId: q.salespersonId ?? customer.salespersonId ?? actor.userId,
        currency: q.currency,
        fxRate: fxRate.toFixed(),
        incoterm: q.incoterm,
        loadingPortId: q.loadingPortId,
        destinationCountry: q.destinationCountry ?? customer.countryCode,
        destinationPortId: q.destinationPortId,
        shippingAddressId: customer.addresses.find((a) => a.type === 'SHIPPING' && a.isDefault)?.id ?? null,
        billingAddressId: customer.addresses.find((a) => a.type === 'BILLING' && a.isDefault)?.id ?? null,
        paymentTermId: q.paymentTermId ?? customer.paymentTermId,
        requestedShipmentDate: q.estimatedShipmentDate,
        notes: q.notes,
        subtotal: q.subtotal,
        discountTotal: q.discountTotal,
        grandTotal: q.grandTotal,
        grandTotalBase: toBase(q.grandTotal.toFixed(), fxRate, company.baseMinorUnits).toFixed(),
        createdById: actor.userId,
        updatedById: actor.userId,
        lines: {
          create: q.lines.map((l) => ({
            lineNo: l.lineNo,
            variantId: l.variantId,
            description: l.description,
            specSnapshot: l.specSnapshot as Prisma.InputJsonValue,
            packagingTypeId: l.packagingTypeId,
            qty: l.qty,
            uom: l.uom,
            qtyBase: l.qtyBase,
            unitPrice: l.unitPrice,
            discountPct: l.discountPct,
            lineTotal: l.lineTotal,
            tolerancePct: company.defaultTolerancePct,
            notes: l.notes,
          })),
        },
      },
    });
    await this.audit.log(tx, actor, { entityType: 'sales_order', entityId: so.id, action: 'create', details: { fromQuotation: q.number, revision: q.revision } });
    await this.audit.activity(tx, actor, {
      eventType: 'sales_order.created',
      entityType: 'sales_order',
      entityId: so.id,
      salesOrderId: so.id,
      customerId: so.customerId,
      summary: `Sales order ${so.number} created from quotation ${q.number} rev ${q.revision}`,
    });
    return { id: so.id, number: so.number };
  }

  async update(actor: Actor, id: string, input: UpdateSalesOrderInput): Promise<SalesOrderDto> {
    const so = await this.prisma.tx(async (tx) => {
      const current = await this.find(actor, id, tx);
      assertVersion('Sales order', current.version, input.version);
      if (!EDITABLE.has(current.status)) {
        throw new BusinessRuleError('Only draft or unconfirmed orders can be edited. Reopen the order first.', 'NOT_EDITABLE');
      }
      const { company, data, fxRate } = await this.header(tx, actor, input);
      const doc = await this.lines.prepare(tx, input.currency, input.lines);
      await tx.salesOrderLine.deleteMany({ where: { salesOrderId: id } });
      const updated = await tx.salesOrder.update({
        where: { id },
        data: {
          ...data,
          subtotal: doc.totals.subtotal.toFixed(),
          discountTotal: doc.totals.discountTotal.toFixed(),
          grandTotal: doc.totals.grandTotal.toFixed(),
          grandTotalBase: toBase(doc.totals.grandTotal, fxRate, company.baseMinorUnits).toFixed(),
          updatedById: actor.userId,
          version: { increment: 1 },
          lines: { create: this.lineData(doc.lines, input, company.defaultTolerancePct) },
        },
        include,
      });
      await this.audit.log(tx, actor, {
        entityType: 'sales_order',
        entityId: id,
        action: 'update',
        before: { ...current, lines: describeLines(current.lines) },
        after: { ...updated, lines: describeLines(updated.lines) },
      });
      return updated;
    });
    return this.toDto(actor, so);
  }

  async submit(actor: Actor, id: string, version: number): Promise<SalesOrderDto> {
    return this.simpleTransition(actor, id, version, ['DRAFT'], 'PENDING_CONFIRMATION', 'sent for customer confirmation');
  }

  private async simpleTransition(
    actor: Actor,
    id: string,
    version: number,
    from: string[],
    to: 'PENDING_CONFIRMATION' | 'ON_HOLD' | 'CONFIRMED',
    label: string,
    reason?: string,
  ): Promise<SalesOrderDto> {
    const so = await this.prisma.tx(async (tx) => {
      const current = await this.find(actor, id, tx);
      assertVersion('Sales order', current.version, version);
      if (!from.includes(current.status)) throw new BusinessRuleError(`Order is ${current.status}; cannot change to ${to}`);
      const updated = await tx.salesOrder.update({
        where: { id },
        data: { status: to, updatedById: actor.userId, version: { increment: 1 } },
        include,
      });
      await this.audit.log(tx, actor, { entityType: 'sales_order', entityId: id, action: 'status', before: { status: current.status }, after: { status: to }, reason });
      await this.audit.activity(tx, actor, {
        eventType: `sales_order.${to.toLowerCase()}`,
        entityType: 'sales_order',
        entityId: id,
        salesOrderId: id,
        customerId: current.customerId,
        summary: `Order ${current.number} ${label}${reason ? `: ${reason}` : ''}`,
      });
      return updated;
    });
    return this.toDto(actor, so);
  }

  hold(actor: Actor, id: string, version: number, reason: string) {
    return this.simpleTransition(actor, id, version, ['CONFIRMED'], 'ON_HOLD', 'put on hold', reason);
  }

  release(actor: Actor, id: string, version: number, reason: string) {
    return this.simpleTransition(actor, id, version, ['ON_HOLD'], 'CONFIRMED', 'released from hold', reason);
  }

  // ───────────── Credit & confirmation ─────────────

  private async evaluate(tx: Tx, actor: Actor, so: SalesOrderRow): Promise<CreditEvaluation> {
    const installments = so.paymentTerm?.installments ?? [];
    return this.credit.evaluateOrder(
      actor.companyId,
      so.customerId,
      so.id,
      dec(so.grandTotalBase.toFixed()),
      securedPercent(installments),
      tx,
    );
  }

  private canOverride(actor: Actor, e: CreditEvaluation): boolean {
    if (e.result === 'PASS') return true;
    if (e.result === 'BLOCK') return can(actor, 'credit.override_block');
    return can(actor, 'credit.override');
  }

  async creditPreview(actor: Actor, id: string): Promise<CreditPreviewDto> {
    const so = await this.find(actor, id);
    const e = await this.evaluate(this.prisma, actor, so);
    return {
      result: e.result,
      reasons: e.reasons,
      currency: so.customer.creditLimitCurrency,
      creditLimit: e.creditLimit.toFixed(2),
      exposure: e.exposure.toFixed(2),
      availableBefore: e.availableBefore.toFixed(2),
      newOrderValue: e.newOrderValue.toFixed(2),
      newOrderUnsecured: e.newOrderUnsecured.toFixed(2),
      availableAfter: e.availableAfter.toFixed(2),
      excess: e.excess.toFixed(2),
      canOverride: this.canOverride(actor, e),
    };
  }

  private async saveCheck(tx: Tx, actor: Actor, so: SalesOrderRow, e: CreditEvaluation): Promise<string> {
    const check = await tx.creditCheck.create({
      data: {
        salesOrderId: so.id,
        customerId: so.customerId,
        evaluatedById: actor.userId,
        currency: so.customer.creditLimitCurrency,
        creditLimit: e.creditLimit.toFixed(),
        openAr: e.openAr.toFixed(),
        overdueAmount: e.overdueAmount.toFixed(),
        openOrders: e.openOrders.toFixed(),
        unappliedCredit: e.unappliedCredit.toFixed(),
        exposure: e.exposure.toFixed(),
        newOrderValue: e.newOrderValue.toFixed(),
        newOrderUnsecured: e.newOrderUnsecured.toDecimalPlaces(4).toFixed(),
        availableAfter: e.availableAfter.toDecimalPlaces(4).toFixed(),
        excess: e.excess.toDecimalPlaces(4).toFixed(),
        result: e.result,
        reasons: e.reasons,
      },
    });
    return check.id;
  }

  /**
   * Confirms an order: freezes the exchange rate, runs the credit check (override needs permission
   * and a reason), and snapshots the payment schedule with due dates / estimates.
   */
  async confirm(actor: Actor, id: string, input: ConfirmSalesOrderInput): Promise<SalesOrderDto> {
    const failed = await this.prisma.tx(async (tx) => {
      // Lock the customer row so two orders for the same customer are credit-checked one at a time.
      const target = await tx.salesOrder.findFirst({ where: { id, companyId: actor.companyId }, select: { customerId: true } });
      if (target) await tx.$queryRaw`SELECT id FROM customers WHERE id = ${target.customerId}::uuid FOR UPDATE`;
      const so = await this.find(actor, id, tx);
      assertVersion('Sales order', so.version, input.version);
      if (!EDITABLE.has(so.status)) throw new BusinessRuleError(`Order is ${so.status} and cannot be confirmed`);
      if (so.lines.filter((l) => l.lineStatus !== 'CANCELLED').length === 0) throw new BusinessRuleError('The order has no lines');
      if (so.customer.status === 'INACTIVE') throw new BusinessRuleError('The customer is archived');

      const company = await this.company.get(actor.companyId, tx);
      const today = this.company.today(company);
      // Re-freeze the rate on the order date (rates may have been corrected since the draft was saved).
      const fxRate = await this.fx.rate(so.currency, company.baseCurrency, dayReq(so.orderDate), tx);
      const grandTotalBase = toBase(so.grandTotal.toFixed(), fxRate, company.baseMinorUnits);
      await tx.salesOrder.update({ where: { id }, data: { fxRate: fxRate.toFixed(), grandTotalBase: grandTotalBase.toFixed() } });
      const fresh = await this.find(actor, id, tx);

      const evaluation = await this.evaluate(tx, actor, fresh);
      // Credit controllers without sales_order.confirm may only confirm as an override of a failed check.
      if (!can(actor, 'sales_order.confirm') && (evaluation.result === 'PASS' || !input.overrideReason)) {
        throw new ForbiddenError('Only sales can confirm orders; credit controllers confirm only to override a failed credit check');
      }
      const checkId = await this.saveCheck(tx, actor, fresh, evaluation);
      if (evaluation.result !== 'PASS') {
        const reason = input.overrideReason?.trim();
        if (!reason) return { evaluation, checkId };
        if (!this.canOverride(actor, evaluation)) {
          throw new ForbiddenError(
            evaluation.result === 'BLOCK'
              ? 'Only management can confirm orders for blocked customers or with old overdue amounts'
              : 'You are not allowed to override the credit limit',
          );
        }
        await tx.creditOverride.create({ data: { creditCheckId: checkId, approvedById: actor.userId, reason } });
        await this.audit.log(tx, actor, {
          entityType: 'sales_order',
          entityId: id,
          action: 'credit_override',
          details: { result: evaluation.result, excess: evaluation.excess.toFixed(2), reasons: evaluation.reasons },
          reason,
        });
        await this.audit.activity(tx, actor, {
          eventType: 'sales_order.credit_override',
          entityType: 'sales_order',
          entityId: id,
          salesOrderId: id,
          customerId: so.customerId,
          summary: `Credit check ${evaluation.result} overridden by ${actor.fullName}: ${reason}`,
        });
      }

      const term = fresh.paymentTerm;
      if (term) {
        const schedule = buildInstallmentSchedule(
          term.installments.map((i) => ({
            percent: i.percent.toFixed(),
            triggerEvent: i.triggerEvent,
            offsetDays: i.offsetDays,
            instrument: i.instrument,
          })),
          {
            total: fresh.grandTotal.toFixed(),
            minorUnits: await this.company.minorUnits(fresh.currency, tx),
            eventDates: { ORDER_CONFIRMATION: today },
            estimatedEventDates: estimatedEvents(day(fresh.requestedShipmentDate), dayReq(fresh.orderDate)),
          },
        );
        await tx.salesOrderPaymentSchedule.deleteMany({ where: { salesOrderId: id } });
        await tx.salesOrderPaymentSchedule.createMany({
          data: schedule.map((s) => ({
            salesOrderId: id,
            seq: s.seq,
            percent: s.percent.toFixed(),
            amount: s.amount.toFixed(),
            triggerEvent: s.triggerEvent,
            offsetDays: s.offsetDays,
            instrument: s.instrument,
            dueDate: s.dueDate ? isoToDate(s.dueDate) : null,
            estimatedDueDate: s.estimatedDueDate ? isoToDate(s.estimatedDueDate) : null,
            dueStatus: s.dueStatus,
          })),
        });
      }
      if (so.customer.status === 'PROSPECT') {
        await tx.customer.update({ where: { id: so.customerId }, data: { status: 'ACTIVE', version: { increment: 1 } } });
        await this.audit.log(tx, actor, { entityType: 'customer', entityId: so.customerId, action: 'update', before: { status: 'PROSPECT' }, after: { status: 'ACTIVE' }, reason: `First order ${so.number} confirmed` });
      }
      await tx.salesOrder.update({
        where: { id },
        data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedById: actor.userId, updatedById: actor.userId, version: { increment: 1 } },
      });
      await this.audit.log(tx, actor, { entityType: 'sales_order', entityId: id, action: 'confirm', before: { status: so.status }, after: { status: 'CONFIRMED', fxRate: fxRate.toFixed() } });
      await this.audit.activity(tx, actor, {
        eventType: 'sales_order.confirmed',
        entityType: 'sales_order',
        entityId: id,
        salesOrderId: id,
        customerId: so.customerId,
        summary: `Order ${so.number} confirmed (${so.currency} ${so.grandTotal.toFixed(2)}, credit ${evaluation.result})`,
      });
      await this.audit.outbox(tx, 'sales_order.confirmed', 'sales_order', id, {
        number: so.number,
        customerId: so.customerId,
        currency: so.currency,
        grandTotal: so.grandTotal,
      });
      return null;
    });

    if (failed) {
      const e = failed.evaluation;
      throw new BusinessRuleError(
        e.result === 'BLOCK'
          ? `Credit check blocked this order: ${e.reasons.join('; ')}`
          : `Credit limit exceeded by ${e.excess.toFixed(2)} ${(await this.find(actor, id)).customer.creditLimitCurrency}`,
        'CREDIT_CHECK_FAILED',
        await this.creditPreview(actor, id),
      );
    }
    return this.get(actor, id);
  }

  // ───────────── Reopen / cancel / delete / lines ─────────────

  private async allocationCount(tx: Tx, salesOrderId: string): Promise<number> {
    return tx.orderAllocation.count({ where: { salesOrderLine: { salesOrderId } } });
  }

  /** Back to draft for amendments; only while nothing has been purchased against it. */
  async reopen(actor: Actor, id: string, version: number, reason: string): Promise<SalesOrderDto> {
    const so = await this.prisma.tx(async (tx) => {
      const current = await this.find(actor, id, tx);
      assertVersion('Sales order', current.version, version);
      if (!['CONFIRMED', 'ON_HOLD'].includes(current.status)) throw new BusinessRuleError(`A ${current.status} order cannot be reopened`);
      if ((await this.allocationCount(tx, id)) > 0) {
        throw new BusinessRuleError('Purchases are linked to this order. Remove the allocations before reopening.', 'HAS_ALLOCATIONS');
      }
      await tx.salesOrderPaymentSchedule.deleteMany({ where: { salesOrderId: id } });
      const updated = await tx.salesOrder.update({
        where: { id },
        data: { status: 'DRAFT', updatedById: actor.userId, version: { increment: 1 } },
        include,
      });
      await this.audit.log(tx, actor, { entityType: 'sales_order', entityId: id, action: 'reopen', before: { status: current.status }, after: { status: 'DRAFT' }, reason });
      await this.audit.activity(tx, actor, {
        eventType: 'sales_order.reopened',
        entityType: 'sales_order',
        entityId: id,
        salesOrderId: id,
        customerId: current.customerId,
        summary: `Order ${current.number} reopened for changes: ${reason}`,
      });
      return updated;
    });
    return this.toDto(actor, so);
  }

  /** Cancels the order and releases its allocations (the purchased goods become free stock on the PO). */
  async cancel(actor: Actor, id: string, version: number, reason: string): Promise<SalesOrderDto> {
    const so = await this.prisma.tx(async (tx) => {
      const current = await this.find(actor, id, tx);
      assertVersion('Sales order', current.version, version);
      if (['CANCELLED', 'CLOSED'].includes(current.status)) throw new BusinessRuleError(`Order is already ${current.status}`);
      const allocations = current.lines.flatMap((l) => l.allocations);
      for (const a of allocations) {
        await tx.orderAllocation.delete({ where: { id: a.id } });
        await this.audit.log(tx, actor, {
          entityType: 'order_allocation',
          entityId: a.id,
          action: 'release',
          details: { salesOrder: current.number, purchaseOrder: a.purchaseOrderLine.purchaseOrder.number, qtyBase: a.qtyBase },
          reason: `Order cancelled: ${reason}`,
        });
      }
      const updated = await tx.salesOrder.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason, updatedById: actor.userId, version: { increment: 1 } },
        include,
      });
      await this.audit.log(tx, actor, { entityType: 'sales_order', entityId: id, action: 'cancel', before: { status: current.status }, after: { status: 'CANCELLED' }, reason });
      await this.audit.activity(tx, actor, {
        eventType: 'sales_order.cancelled',
        entityType: 'sales_order',
        entityId: id,
        salesOrderId: id,
        customerId: current.customerId,
        summary: `Order ${current.number} cancelled${allocations.length ? ` (${allocations.length} purchase allocation(s) released)` : ''}: ${reason}`,
      });
      await this.audit.outbox(tx, 'sales_order.cancelled', 'sales_order', id, { number: current.number, reason });
      return updated;
    });
    return this.toDto(actor, so);
  }

  async delete(actor: Actor, id: string): Promise<void> {
    await this.prisma.tx(async (tx) => {
      const current = await this.find(actor, id, tx);
      if (current.status !== 'DRAFT' || current.confirmedAt) {
        throw new BusinessRuleError('Only drafts that were never confirmed can be deleted. Cancel the order instead.');
      }
      await tx.salesOrder.delete({ where: { id } });
      if (current.quotationId) {
        await tx.quotation.update({ where: { id: current.quotationId }, data: { status: 'ACCEPTED', version: { increment: 1 } } });
      }
      await this.audit.log(tx, actor, { entityType: 'sales_order', entityId: id, action: 'delete', before: current, after: null });
    });
  }

  /**
   * Closes a line short (the rest will not be delivered) or cancels it (nothing purchased).
   * Cancelling changes the order value, so totals and the payment schedule are recalculated.
   */
  async closeLine(actor: Actor, id: string, lineId: string, mode: 'CLOSED_SHORT' | 'CANCELLED', reason: string): Promise<SalesOrderDto> {
    const so = await this.prisma.tx(async (tx) => {
      const current = await this.find(actor, id, tx);
      if (!['CONFIRMED', 'ON_HOLD'].includes(current.status)) throw new BusinessRuleError('Lines can only be closed on confirmed orders');
      const line = current.lines.find((l) => l.id === lineId);
      if (!line) throw new NotFoundError('Order line', lineId);
      if (line.lineStatus !== 'OPEN') throw new BusinessRuleError(`Line is already ${line.lineStatus}`);
      if (mode === 'CANCELLED' && line.allocations.length > 0) {
        throw new BusinessRuleError('Purchases are linked to this line. Close it short or remove the allocations first.', 'HAS_ALLOCATIONS');
      }
      await tx.salesOrderLine.update({ where: { id: lineId }, data: { lineStatus: mode, closedReason: reason } });
      if (mode === 'CANCELLED') {
        const remaining = current.lines.filter((l) => l.id !== lineId && l.lineStatus !== 'CANCELLED');
        if (remaining.length === 0) throw new BusinessRuleError('This is the last line. Cancel the whole order instead.');
        await this.recalculate(tx, actor, current.id);
      }
      await this.audit.log(tx, actor, {
        entityType: 'sales_order',
        entityId: id,
        action: mode === 'CANCELLED' ? 'line_cancelled' : 'line_closed_short',
        details: { lineNo: line.lineNo, description: line.description },
        reason,
      });
      await this.audit.activity(tx, actor, {
        eventType: mode === 'CANCELLED' ? 'sales_order.line_cancelled' : 'sales_order.line_closed_short',
        entityType: 'sales_order',
        entityId: id,
        salesOrderId: id,
        customerId: current.customerId,
        summary: `Line ${line.lineNo} (${line.description}) ${mode === 'CANCELLED' ? 'cancelled' : 'closed short'}: ${reason}`,
      });
      return this.find(actor, id, tx);
    });
    return this.toDto(actor, so);
  }

  /** Recomputes header totals and schedule amounts from active lines (keeps due dates). */
  private async recalculate(tx: Tx, actor: Actor, id: string): Promise<void> {
    const so = await tx.salesOrder.findUniqueOrThrow({ where: { id }, include: { lines: true, paymentSchedule: { orderBy: { seq: 'asc' } } } });
    const company = await this.company.get(actor.companyId, tx);
    const minor = await this.company.minorUnits(so.currency, tx);
    const active = so.lines.filter((l) => l.lineStatus !== 'CANCELLED');
    const subtotal = sum(active.map((l) => l.lineTotal.toFixed()));
    const gross = sum(active.map((l) => roundMoney(dec(l.qty.toFixed()).times(l.unitPrice.toFixed()), minor)));
    await tx.salesOrder.update({
      where: { id },
      data: {
        subtotal: subtotal.toFixed(),
        discountTotal: gross.minus(subtotal).toFixed(),
        grandTotal: subtotal.toFixed(),
        grandTotalBase: toBase(subtotal, so.fxRate.toFixed(), company.baseMinorUnits).toFixed(),
        version: { increment: 1 },
      },
    });
    let allocated = new Decimal(0);
    for (const [i, s] of so.paymentSchedule.entries()) {
      const amount = i === so.paymentSchedule.length - 1 ? subtotal.minus(allocated) : roundMoney(subtotal.times(s.percent.toFixed()).div(100), minor);
      allocated = allocated.plus(amount);
      await tx.salesOrderPaymentSchedule.update({ where: { id: s.id }, data: { amount: amount.toFixed() } });
    }
  }

  // ───────────── Awaiting purchase ─────────────

  async awaitingPurchase(actor: Actor, q: ListQuery & { customerId?: string; productId?: string }): Promise<AwaitingPurchaseItemDto[]> {
    const lines = await this.prisma.salesOrderLine.findMany({
      where: {
        lineStatus: 'OPEN',
        salesOrder: {
          companyId: actor.companyId,
          status: 'CONFIRMED',
          ...viaCustomerScope(actor),
          ...(q.customerId ? { customerId: q.customerId } : {}),
        },
        ...(q.productId ? { variant: { productId: q.productId } } : {}),
        ...(q.q ? { OR: [{ description: contains(q.q) }, { salesOrder: { number: contains(q.q) } }, { salesOrder: { customer: { companyName: contains(q.q) } } }] } : {}),
      },
      include: { salesOrder: { include: { customer: true } }, variant: true },
      orderBy: [{ salesOrder: { confirmedAt: 'asc' } }, { lineNo: 'asc' }],
      take: 1000,
    });
    const progress = await loadFulfillment(this.prisma, [...new Set(lines.map((l) => l.salesOrderId))]);
    const company = await this.company.get(actor.companyId);
    const today = this.company.today(company);
    const out: AwaitingPurchaseItemDto[] = [];
    for (const l of lines) {
      const f = progress.get(l.salesOrderId)?.find((x) => x.salesOrderLineId === l.id);
      if (!f) continue;
      const p = soLineProgress(f);
      if (p.remainingToPurchase.lte(0)) continue;
      out.push({
        salesOrderLineId: l.id,
        salesOrder: { id: l.salesOrder.id, code: l.salesOrder.number, name: l.salesOrder.number },
        customer: refReq(l.salesOrder.customer),
        orderDate: dayReq(l.salesOrder.orderDate),
        requestedShipmentDate: day(l.salesOrder.requestedShipmentDate),
        lineNo: l.lineNo,
        productId: l.variant.productId,
        variantId: l.variantId,
        description: l.description,
        uom: l.uom,
        orderedQtyBase: p.ordered.toFixed(),
        purchasedQtyBase: p.purchased.toFixed(),
        remainingQtyBase: p.remainingToPurchase.toFixed(),
        unitPrice: l.unitPrice.toFixed(),
        currency: l.salesOrder.currency,
        daysSinceConfirmation: l.salesOrder.confirmedAt ? diffDays(l.salesOrder.confirmedAt.toISOString().slice(0, 10), today) : 0,
      });
    }
    return out;
  }
}

function describeLines(lines: { lineNo: number; description: string; qty: Prisma.Decimal; uom: string; unitPrice: Prisma.Decimal }[]): string {
  return lines.map((l) => `${l.lineNo}: ${l.description} ${l.qty.toFixed()} ${l.uom} @ ${l.unitPrice.toFixed()}`).join(' | ');
}
