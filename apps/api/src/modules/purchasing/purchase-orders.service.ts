import { Injectable } from '@nestjs/common';
import type {
  ActivityEventDto,
  AllocationDto,
  AllocationInput,
  ListQuery,
  MilestoneDto,
  MilestoneInput,
  Page,
  PurchaseFromSalesInput,
  PurchaseOrderDto,
  PurchaseOrderInput,
  PurchaseOrderLineDto,
  PurchaseOrderListItemDto,
  PurchaseOrderTransitionInput,
  UpdatePurchaseOrderInput,
} from '@fillco/contracts';
import { Prisma } from '@fillco/db';
import {
  assertAllocation,
  buildInstallmentSchedule,
  computeDocumentTotals,
  computeLineTotals,
  dec,
  Decimal,
  isoToDate,
  PO_MILESTONES,
  PO_TRANSITIONS,
  PurchaseOrderStatus,
  sum,
  toBase,
  toBaseQty,
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
import { DocumentLinesService } from '../catalog/document-lines.service';
import { estimatedEvents } from '../sales/sales-orders.service';
import { termSummary } from '../settings/settings.service';

const allocationInclude = {
  salesOrderLine: { include: { salesOrder: { include: { customer: true } } } },
} satisfies Prisma.OrderAllocationInclude;

const include = {
  supplier: true,
  buyer: true,
  paymentTerm: { include: { installments: { orderBy: { seq: 'asc' } } } },
  lines: {
    include: { variant: { include: { product: true } }, allocations: { include: allocationInclude } },
    orderBy: { lineNo: 'asc' },
  },
  paymentSchedule: { orderBy: { seq: 'asc' } },
  milestones: true,
} satisfies Prisma.PurchaseOrderInclude;
type PurchaseOrderRow = Prisma.PurchaseOrderGetPayload<{ include: typeof include }>;

export interface PurchaseOrderFilter extends ListQuery {
  status?: string;
  supplierId?: string;
  delayed?: string;
}

const EDITABLE = new Set<PurchaseOrderStatus>(['DRAFT', 'SENT']);
const ACTIVE_FOR_DELAY = new Set<PurchaseOrderStatus>(['CONFIRMED', 'IN_PRODUCTION']);

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
    private readonly company: CompanyService,
    private readonly fx: FxService,
    private readonly lines: DocumentLinesService,
  ) {}

  private isDelayed(
    po: { status: PurchaseOrderStatus; expectedReadyDate: Date | null; confirmedReadyDate: Date | null },
    today: string,
  ): boolean {
    const ready = po.confirmedReadyDate ?? po.expectedReadyDate;
    return ACTIVE_FOR_DELAY.has(po.status) && !!ready && dayReq(ready) < today;
  }

  private allocationDto(
    actor: Actor,
    a: PurchaseOrderRow['lines'][number]['allocations'][number],
    po: PurchaseOrderRow,
    line: PurchaseOrderRow['lines'][number],
  ): AllocationDto {
    const so = a.salesOrderLine.salesOrder;
    return {
      id: a.id,
      salesOrderLineId: a.salesOrderLineId,
      purchaseOrderLineId: a.purchaseOrderLineId,
      salesOrder: { id: so.id, code: so.number, name: so.number },
      purchaseOrder: { id: po.id, code: po.number, name: po.number },
      customer: refReq(so.customer),
      supplier: refReq(po.supplier),
      poStatus: po.status,
      soLineNo: a.salesOrderLine.lineNo,
      poLineNo: line.lineNo,
      description: a.salesOrderLine.description,
      qtyBase: a.qtyBase.toFixed(),
      isSubstitute: a.isSubstitute,
      substituteNote: a.substituteNote,
      unitCostBase:
        canSeeCosts(actor) && !line.qtyBase.isZero()
          ? line.lineTotal.div(line.qtyBase).toDecimalPlaces(6).toFixed()
          : null,
      poCurrency: po.currency,
      createdAt: tsReq(a.createdAt),
    };
  }

  private async timeline(po: PurchaseOrderRow): Promise<ActivityEventDto[]> {
    const events = await this.prisma.activityEvent.findMany({
      where: { purchaseOrderId: po.id },
      orderBy: { occurredAt: 'asc' },
      take: 200,
    });
    const users = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: events.map((e) => e.userId).filter((x): x is string => !!x) } },
        })
      ).map((u) => [u.id, u]),
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

  private async toDto(actor: Actor, po: PurchaseOrderRow): Promise<PurchaseOrderDto> {
    const company = await this.company.get(actor.companyId);
    const today = this.company.today(company);
    const packaging = await DocumentLinesService.packagingMap(this.prisma);
    const ports = new Map(
      (
        await this.prisma.port.findMany({
          where: { id: { in: [po.loadingPortId, po.destinationPortId].filter((x): x is string => !!x) } },
        })
      ).map((p) => [p.id, p]),
    );
    const showCost = canSeeCosts(actor);
    // Sales staff may see which customers a PO serves only for customers they can see.
    const visibleCustomer = (customer: { salespersonId: string | null }) =>
      can(actor, 'customer.view_all') || customer.salespersonId === actor.userId;

    const lines: PurchaseOrderLineDto[] = po.lines.map((l) => {
      const allocated = sum(l.allocations.map((a) => a.qtyBase.toFixed()));
      return {
        ...DocumentLinesService.toDto(l, packaging, showCost),
        expectedReadyDate: day(l.expectedReadyDate),
        lineStatus: l.lineStatus,
        allocatedQtyBase: allocated.toFixed(),
        unallocatedQtyBase: dec(l.qtyBase.toFixed()).minus(allocated).toFixed(),
        allocations: l.allocations
          .filter((a) => visibleCustomer(a.salesOrderLine.salesOrder.customer))
          .map((a) => this.allocationDto(actor, a, po, l)),
      };
    });
    const salesOrders = new Map<string, PurchaseOrderDto['salesOrders'][number]>();
    for (const l of po.lines)
      for (const a of l.allocations) {
        const so = a.salesOrderLine.salesOrder;
        if (visibleCustomer(so.customer))
          salesOrders.set(so.id, {
            id: so.id,
            code: so.number,
            name: so.number,
            customer: refReq(so.customer),
          });
      }
    const milestoneMap = new Map(po.milestones.map((m) => [m.milestone, m]));
    const milestones: MilestoneDto[] = PO_MILESTONES.map((code) => {
      const m = milestoneMap.get(code);
      return {
        milestone: code,
        plannedDate: day(m?.plannedDate),
        actualDate: day(m?.actualDate),
        notes: m?.notes ?? null,
      };
    });

    return {
      id: po.id,
      number: po.number,
      supplier: refReq(po.supplier),
      supplierRef: po.supplierRef,
      poDate: dayReq(po.poDate),
      buyer: ref(po.buyer),
      currency: po.currency,
      fxRate: po.fxRate.toFixed(),
      incoterm: po.incoterm,
      loadingPort: ref(po.loadingPortId ? ports.get(po.loadingPortId) : null),
      destinationPort: ref(po.destinationPortId ? ports.get(po.destinationPortId) : null),
      paymentTerm: ref(po.paymentTerm),
      paymentTermSummary: po.paymentTerm ? termSummary(po.paymentTerm) : null,
      expectedReadyDate: day(po.expectedReadyDate),
      confirmedReadyDate: day(po.confirmedReadyDate),
      isDelayed: this.isDelayed(po, today),
      status: po.status,
      allowedTransitions: [...PO_TRANSITIONS[po.status]],
      sentAt: ts(po.sentAt),
      confirmedAt: ts(po.confirmedAt),
      cancelledAt: ts(po.cancelledAt),
      cancelReason: po.cancelReason,
      notes: po.notes,
      internalNotes: po.internalNotes,
      subtotal: showCost ? po.subtotal.toFixed() : null,
      discountTotal: showCost ? po.discountTotal.toFixed() : null,
      grandTotal: showCost ? po.grandTotal.toFixed() : null,
      grandTotalBase: showCost ? po.grandTotalBase.toFixed() : null,
      lines,
      paymentSchedule: showCost
        ? po.paymentSchedule.map((s) => ({
            seq: s.seq,
            percent: s.percent.toFixed(),
            amount: s.amount.toFixed(),
            triggerEvent: s.triggerEvent,
            offsetDays: s.offsetDays,
            instrument: s.instrument,
            dueDate: day(s.dueDate),
            estimatedDueDate: day(s.estimatedDueDate),
            dueStatus: s.dueStatus,
          }))
        : null,
      milestones,
      salesOrders: [...salesOrders.values()],
      timeline: await this.timeline(po),
      createdAt: tsReq(po.createdAt),
      version: po.version,
    };
  }

  async list(
    actor: Actor,
    q: PurchaseOrderFilter,
  ): Promise<{ page: Page<PurchaseOrderListItemDto>; rows: PurchaseOrderListItemDto[] }> {
    const company = await this.company.get(actor.companyId);
    const today = this.company.today(company);
    const where: Prisma.PurchaseOrderWhereInput = {
      companyId: actor.companyId,
      ...(q.status
        ? { status: { in: q.status.split(',') as Prisma.EnumPurchaseOrderStatusFilter['in'] } }
        : {}),
      ...(q.supplierId ? { supplierId: q.supplierId } : {}),
      ...(q.delayed === 'true'
        ? {
            status: { in: ['CONFIRMED', 'IN_PRODUCTION'] },
            OR: [
              { confirmedReadyDate: { lt: isoToDate(today) } },
              { confirmedReadyDate: null, expectedReadyDate: { lt: isoToDate(today) } },
            ],
          }
        : {}),
      ...(q.q
        ? {
            AND: [
              {
                OR: [
                  { number: contains(q.q) },
                  { supplierRef: contains(q.q) },
                  { supplier: { companyName: contains(q.q) } },
                  { lines: { some: { description: contains(q.q) } } },
                ],
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        include: {
          supplier: true,
          buyer: true,
          lines: {
            include: {
              allocations: {
                include: { salesOrderLine: { include: { salesOrder: { include: { customer: true } } } } },
              },
            },
          },
        },
        orderBy: orderBy(
          q.sort,
          {
            number: (dir) => ({ number: dir }),
            poDate: (dir) => ({ poDate: dir }),
            grandTotalBase: (dir) => ({ grandTotalBase: dir }),
            status: (dir) => ({ status: dir }),
            expectedReadyDate: (dir) => ({ expectedReadyDate: dir }),
            supplier: (dir) => ({ supplier: { companyName: dir } }),
          },
          { createdAt: 'desc' },
        ) as Prisma.PurchaseOrderOrderByWithRelationInput[],
        ...paging(q),
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);
    const showCost = canSeeCosts(actor);
    const items: PurchaseOrderListItemDto[] = rows.map((po) => {
      const qty = sum(po.lines.map((l) => l.qtyBase.toFixed()));
      const allocated = sum(po.lines.flatMap((l) => l.allocations.map((a) => a.qtyBase.toFixed())));
      const sos = new Map<string, { id: string; code: string; name: string }>();
      for (const l of po.lines)
        for (const a of l.allocations) {
          const so = a.salesOrderLine.salesOrder;
          if (can(actor, 'customer.view_all') || so.customer.salespersonId === actor.userId)
            sos.set(so.id, { id: so.id, code: so.number, name: so.number });
        }
      return {
        id: po.id,
        number: po.number,
        supplier: refReq(po.supplier),
        supplierCountry: po.supplier.countryCode,
        supplierRef: po.supplierRef,
        poDate: dayReq(po.poDate),
        currency: po.currency,
        grandTotal: showCost ? po.grandTotal.toFixed() : null,
        grandTotalBase: showCost ? po.grandTotalBase.toFixed() : null,
        status: po.status,
        expectedReadyDate: day(po.confirmedReadyDate ?? po.expectedReadyDate),
        isDelayed: this.isDelayed(po, today),
        allocatedPct: qty.isZero() ? '0' : allocated.div(qty).times(100).toDecimalPlaces(1).toFixed(),
        salesOrders: [...sos.values()],
        buyer: po.buyer?.fullName ?? null,
      };
    });
    return { page: page(items, total, q), rows: items };
  }

  private async find(actor: Actor, id: string, tx: Tx = this.prisma): Promise<PurchaseOrderRow> {
    const po = await tx.purchaseOrder.findFirst({ where: { id, companyId: actor.companyId }, include });
    if (!po) throw new NotFoundError('Purchase order', id);
    return po;
  }

  async get(actor: Actor, id: string): Promise<PurchaseOrderDto> {
    return this.toDto(actor, await this.find(actor, id));
  }

  // ───────────── Drafts ─────────────

  private async header(tx: Tx, actor: Actor, input: PurchaseOrderInput | PurchaseFromSalesInput) {
    const supplier = await tx.supplier.findFirst({
      where: { id: input.supplierId, companyId: actor.companyId },
    });
    if (!supplier) throw new NotFoundError('Supplier', input.supplierId);
    if (supplier.status !== 'ACTIVE')
      throw new BusinessRuleError(`Supplier ${supplier.companyName} is ${supplier.status}`);
    const company = await this.company.get(actor.companyId, tx);
    const fxRate = await this.fx.rate(input.currency, company.baseCurrency, input.poDate, tx);
    return {
      company,
      fxRate,
      data: {
        supplierId: input.supplierId,
        supplierRef: input.supplierRef ?? null,
        poDate: isoToDate(input.poDate),
        buyerId: ('buyerId' in input ? input.buyerId : undefined) ?? actor.userId,
        currency: input.currency,
        fxRate: fxRate.toFixed(),
        incoterm: input.incoterm ?? supplier.defaultIncoterm ?? null,
        loadingPortId: input.loadingPortId ?? supplier.defaultLoadingPortId ?? null,
        destinationPortId: ('destinationPortId' in input ? input.destinationPortId : null) ?? null,
        paymentTermId: input.paymentTermId ?? supplier.paymentTermId ?? null,
        expectedReadyDate: input.expectedReadyDate ? isoToDate(input.expectedReadyDate) : null,
        notes: input.notes ?? null,
        internalNotes: ('internalNotes' in input ? input.internalNotes : null) ?? null,
      },
    };
  }

  async create(actor: Actor, input: PurchaseOrderInput): Promise<PurchaseOrderDto> {
    const po = await this.prisma.tx(async (tx) => {
      const { company, fxRate, data } = await this.header(tx, actor, input);
      const doc = await this.lines.prepare(tx, input.currency, input.lines);
      const number = await this.sequences.next(tx, actor.companyId, 'PO', yearOf(input.poDate));
      const created = await tx.purchaseOrder.create({
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
          lines: {
            create: doc.lines.map((l, i) => ({
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
              expectedReadyDate: input.lines[i]?.expectedReadyDate
                ? isoToDate(input.lines[i]!.expectedReadyDate!)
                : null,
              notes: l.notes,
            })),
          },
        },
        include,
      });
      await this.audit.log(tx, actor, {
        entityType: 'purchase_order',
        entityId: created.id,
        action: 'create',
        after: created,
      });
      await this.audit.activity(tx, actor, {
        eventType: 'purchase_order.created',
        entityType: 'purchase_order',
        entityId: created.id,
        purchaseOrderId: created.id,
        supplierId: created.supplierId,
        summary: `Purchase order ${created.number} created for ${created.supplier.companyName}`,
      });
      return created;
    });
    return this.toDto(actor, po);
  }

  /**
   * Edits a draft/sent PO. Lines keep their identity by id so allocations survive; a line with
   * allocations cannot change product specification or drop below the allocated quantity.
   */
  async update(actor: Actor, id: string, input: UpdatePurchaseOrderInput): Promise<PurchaseOrderDto> {
    const po = await this.prisma.tx(async (tx) => {
      const current = await this.find(actor, id, tx);
      assertVersion('Purchase order', current.version, input.version);
      if (!EDITABLE.has(current.status))
        throw new BusinessRuleError('Only draft or sent purchase orders can be edited', 'NOT_EDITABLE');
      const { company, fxRate, data } = await this.header(tx, actor, input);
      const doc = await this.lines.prepare(tx, input.currency, input.lines);
      const keepIds = new Set(doc.lines.map((l) => l.id).filter((x): x is string => !!x));
      for (const existing of current.lines) {
        if (!keepIds.has(existing.id)) {
          if (existing.allocations.length > 0) {
            throw new BusinessRuleError(
              `Line ${existing.lineNo} is allocated to sales orders and cannot be removed`,
              'HAS_ALLOCATIONS',
            );
          }
          await tx.purchaseOrderLine.delete({ where: { id: existing.id } });
        }
      }
      // Temporarily move line numbers out of the way to allow re-numbering without unique conflicts.
      await tx.purchaseOrderLine.updateMany({
        where: { purchaseOrderId: id },
        data: { lineNo: { increment: 1000 } },
      });
      for (const [i, l] of doc.lines.entries()) {
        const existing = l.id ? current.lines.find((x) => x.id === l.id) : undefined;
        if (l.id && !existing) throw new NotFoundError('Purchase order line', l.id);
        const row = {
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
          expectedReadyDate: input.lines[i]?.expectedReadyDate
            ? isoToDate(input.lines[i]!.expectedReadyDate!)
            : null,
          notes: l.notes,
        };
        if (existing) {
          if (existing.allocations.length > 0) {
            if (existing.variantId !== l.variantId) {
              throw new BusinessRuleError(
                `Line ${existing.lineNo} is allocated; its specification cannot change`,
                'HAS_ALLOCATIONS',
              );
            }
            const allocated = sum(existing.allocations.map((a) => a.qtyBase.toFixed()));
            if (dec(l.qtyBase).lt(allocated)) {
              throw new BusinessRuleError(
                `Line ${existing.lineNo}: quantity cannot be below the ${allocated.toFixed()} kg already allocated`,
              );
            }
          }
          await tx.purchaseOrderLine.update({ where: { id: existing.id }, data: row });
        } else {
          await tx.purchaseOrderLine.create({ data: { ...row, purchaseOrderId: id } });
        }
      }
      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: {
          ...data,
          subtotal: doc.totals.subtotal.toFixed(),
          discountTotal: doc.totals.discountTotal.toFixed(),
          grandTotal: doc.totals.grandTotal.toFixed(),
          grandTotalBase: toBase(doc.totals.grandTotal, fxRate, company.baseMinorUnits).toFixed(),
          updatedById: actor.userId,
          version: { increment: 1 },
        },
        include,
      });
      await this.audit.log(tx, actor, {
        entityType: 'purchase_order',
        entityId: id,
        action: 'update',
        before: current,
        after: updated,
      });
      return updated;
    });
    return this.toDto(actor, po);
  }

  async delete(actor: Actor, id: string): Promise<void> {
    await this.prisma.tx(async (tx) => {
      const current = await this.find(actor, id, tx);
      if (current.status !== 'DRAFT')
        throw new BusinessRuleError('Only draft purchase orders can be deleted. Cancel it instead.');
      const allocations = current.lines.flatMap((l) => l.allocations);
      if (allocations.length)
        await tx.orderAllocation.deleteMany({ where: { id: { in: allocations.map((a) => a.id) } } });
      await tx.purchaseOrder.delete({ where: { id } });
      await this.audit.log(tx, actor, {
        entityType: 'purchase_order',
        entityId: id,
        action: 'delete',
        before: current,
        after: null,
        details: allocations.length ? { releasedAllocations: allocations.length } : undefined,
      });
      for (const soId of new Set(allocations.map((a) => a.salesOrderLine.salesOrderId))) {
        await this.audit.activity(tx, actor, {
          eventType: 'allocation.released',
          entityType: 'purchase_order',
          entityId: id,
          salesOrderId: soId,
          summary: `Draft purchase order ${current.number} deleted; its allocations were released`,
        });
      }
    });
  }

  // ───────────── Status workflow ─────────────

  async transition(actor: Actor, id: string, input: PurchaseOrderTransitionInput): Promise<PurchaseOrderDto> {
    const po = await this.prisma.tx(async (tx) => {
      const current = await this.find(actor, id, tx);
      assertVersion('Purchase order', current.version, input.version);
      const to = input.to;
      if (!PO_TRANSITIONS[current.status].includes(to)) {
        throw new BusinessRuleError(`A ${current.status} purchase order cannot move to ${to}`);
      }
      if (to === 'CANCELLED') {
        if (!can(actor, 'purchase_order.cancel')) throw new ForbiddenError();
        if (!input.reason)
          throw new BusinessRuleError('A reason is required to cancel', 'VALIDATION', undefined, {
            reason: ['Required'],
          });
      } else if (!can(actor, 'purchase_order.confirm')) {
        throw new ForbiddenError();
      }
      const company = await this.company.get(actor.companyId, tx);
      const today = this.company.today(company);
      const data: Prisma.PurchaseOrderUpdateInput = {
        status: to,
        updatedById: actor.userId,
        version: { increment: 1 },
      };
      if (input.supplierRef) data.supplierRef = input.supplierRef;
      if (input.confirmedReadyDate) data.confirmedReadyDate = isoToDate(input.confirmedReadyDate);

      if (to === 'SENT') data.sentAt = new Date();
      if (to === 'CONFIRMED') {
        data.confirmedAt = new Date();
        // Freeze the rate and snapshot the supplier payment schedule.
        const fxRate = await this.fx.rate(current.currency, company.baseCurrency, dayReq(current.poDate), tx);
        data.fxRate = fxRate.toFixed();
        data.grandTotalBase = toBase(current.grandTotal.toFixed(), fxRate, company.baseMinorUnits).toFixed();
        await tx.purchaseOrderPaymentSchedule.deleteMany({ where: { purchaseOrderId: id } });
        if (current.paymentTerm) {
          const ready =
            input.confirmedReadyDate ?? day(current.confirmedReadyDate ?? current.expectedReadyDate);
          const schedule = buildInstallmentSchedule(
            current.paymentTerm.installments.map((i) => ({
              percent: i.percent.toFixed(),
              triggerEvent: i.triggerEvent,
              offsetDays: i.offsetDays,
              instrument: i.instrument,
            })),
            {
              total: current.grandTotal.toFixed(),
              minorUnits: await this.company.minorUnits(current.currency, tx),
              eventDates: { ORDER_CONFIRMATION: today },
              estimatedEventDates: estimatedEvents(ready, dayReq(current.poDate)),
            },
          );
          await tx.purchaseOrderPaymentSchedule.createMany({
            data: schedule.map((s) => ({
              purchaseOrderId: id,
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
      }
      if (to === 'DRAFT') {
        data.sentAt = null;
      }
      if (to === 'IN_PRODUCTION') {
        await this.upsertMilestone(tx, id, { milestone: 'PRODUCTION_STARTED', actualDate: today });
      }
      if (to === 'READY') {
        await this.upsertMilestone(tx, id, { milestone: 'READY', actualDate: today });
      }
      if (to === 'CANCELLED') {
        data.cancelledAt = new Date();
        data.cancelReason = input.reason ?? null;
        const allocations = current.lines.flatMap((l) => l.allocations);
        for (const a of allocations) {
          await tx.orderAllocation.delete({ where: { id: a.id } });
          await this.audit.activity(tx, actor, {
            eventType: 'allocation.released',
            entityType: 'order_allocation',
            entityId: a.id,
            salesOrderId: a.salesOrderLine.salesOrderId,
            purchaseOrderId: id,
            customerId: a.salesOrderLine.salesOrder.customerId,
            summary: `PO ${current.number} cancelled: ${a.qtyBase.toFixed()} kg for ${a.salesOrderLine.salesOrder.number} line ${a.salesOrderLine.lineNo} must be re-purchased`,
          });
        }
      }
      const updated = await tx.purchaseOrder.update({ where: { id }, data, include });
      await this.audit.log(tx, actor, {
        entityType: 'purchase_order',
        entityId: id,
        action: `status_${to.toLowerCase()}`,
        before: { status: current.status },
        after: { status: to, fxRate: updated.fxRate, confirmedReadyDate: updated.confirmedReadyDate },
        reason: input.reason,
      });
      const labels: Record<PurchaseOrderStatus, string> = {
        DRAFT: 'returned to draft',
        SENT: 'sent to supplier',
        CONFIRMED: 'confirmed by supplier',
        IN_PRODUCTION: 'in production',
        READY: 'ready for shipment',
        CLOSED: 'closed',
        CANCELLED: 'cancelled',
      };
      await this.audit.activity(tx, actor, {
        eventType: `purchase_order.${to.toLowerCase()}`,
        entityType: 'purchase_order',
        entityId: id,
        purchaseOrderId: id,
        supplierId: current.supplierId,
        summary: `Purchase order ${current.number} ${labels[to]}${input.reason ? `: ${input.reason}` : ''}`,
      });
      await this.audit.outbox(tx, `purchase_order.${to.toLowerCase()}`, 'purchase_order', id, {
        number: current.number,
        status: to,
      });
      return updated;
    });
    return this.toDto(actor, po);
  }

  private async upsertMilestone(
    tx: Tx,
    purchaseOrderId: string,
    input: {
      milestone: MilestoneInput['milestone'];
      plannedDate?: string | null;
      actualDate?: string | null;
      notes?: string | null;
    },
  ) {
    const data = {
      ...(input.plannedDate !== undefined
        ? { plannedDate: input.plannedDate ? isoToDate(input.plannedDate) : null }
        : {}),
      ...(input.actualDate !== undefined
        ? { actualDate: input.actualDate ? isoToDate(input.actualDate) : null }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    };
    await tx.purchaseOrderMilestone.upsert({
      where: { purchaseOrderId_milestone: { purchaseOrderId, milestone: input.milestone } },
      create: { purchaseOrderId, milestone: input.milestone, ...data },
      update: data,
    });
  }

  async saveMilestone(actor: Actor, id: string, input: MilestoneInput): Promise<PurchaseOrderDto> {
    const po = await this.prisma.tx(async (tx) => {
      const current = await this.find(actor, id, tx);
      if (['CANCELLED', 'CLOSED'].includes(current.status))
        throw new BusinessRuleError(`Purchase order is ${current.status}`);
      await this.upsertMilestone(tx, id, input);
      await this.audit.log(tx, actor, {
        entityType: 'purchase_order',
        entityId: id,
        action: 'milestone',
        details: { ...input },
      });
      if (input.actualDate) {
        await this.audit.activity(tx, actor, {
          eventType: `purchase_order.milestone.${input.milestone.toLowerCase()}`,
          entityType: 'purchase_order',
          entityId: id,
          purchaseOrderId: id,
          supplierId: current.supplierId,
          summary: `${current.number}: ${input.milestone.replace(/_/g, ' ').toLowerCase()} on ${input.actualDate}`,
        });
      }
      return this.find(actor, id, tx);
    });
    return this.toDto(actor, po);
  }

  // ───────────── Allocations (SO line ↔ PO line) ─────────────

  private async lockLines(tx: Tx, soLineId: string, poLineId: string): Promise<void> {
    // Always lock in the same order (SO line, then PO line) to avoid deadlocks.
    await tx.$queryRaw`SELECT id FROM sales_order_lines WHERE id = ${soLineId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM purchase_order_lines WHERE id = ${poLineId}::uuid FOR UPDATE`;
  }

  async allocateInTx(tx: Tx, actor: Actor, input: AllocationInput): Promise<string> {
    await this.lockLines(tx, input.salesOrderLineId, input.purchaseOrderLineId);
    const soLine = await tx.salesOrderLine.findFirst({
      where: {
        id: input.salesOrderLineId,
        salesOrder: { companyId: actor.companyId, ...viaCustomerScope(actor) },
      },
      include: { salesOrder: true, variant: true, allocations: true },
    });
    if (!soLine) throw new NotFoundError('Sales order line', input.salesOrderLineId);
    const poLine = await tx.purchaseOrderLine.findFirst({
      where: { id: input.purchaseOrderLineId, purchaseOrder: { companyId: actor.companyId } },
      include: { purchaseOrder: true, variant: true, allocations: true },
    });
    if (!poLine) throw new NotFoundError('Purchase order line', input.purchaseOrderLineId);
    if (soLine.salesOrder.status !== 'CONFIRMED')
      throw new BusinessRuleError(`Sales order ${soLine.salesOrder.number} is not confirmed`);
    if (soLine.lineStatus !== 'OPEN') throw new BusinessRuleError('Sales order line is closed');
    if (['CANCELLED', 'CLOSED'].includes(poLine.purchaseOrder.status)) {
      throw new BusinessRuleError(
        `Purchase order ${poLine.purchaseOrder.number} is ${poLine.purchaseOrder.status}`,
      );
    }
    if (poLine.lineStatus !== 'OPEN') throw new BusinessRuleError('Purchase order line is closed');
    const isSubstitute = soLine.variantId !== poLine.variantId;
    if (isSubstitute && !input.substituteNote) {
      throw new BusinessRuleError(
        `Specifications differ (${soLine.variant.displayName} vs ${poLine.variant.displayName}). Add a note to allocate as a substitute.`,
        'SPEC_MISMATCH',
        undefined,
        { substituteNote: ['Required when specifications differ'] },
      );
    }
    const uom = await tx.uom.findUnique({ where: { code: input.uom } });
    if (!uom || uom.dimension !== 'MASS') throw new BusinessRuleError(`Unknown unit ${input.uom}`);
    const qtyBase = toBaseQty(input.qty, uom.factorToBase.toFixed());
    const existing = soLine.allocations.find((a) => a.purchaseOrderLineId === poLine.id);
    const soAllocated = sum(
      soLine.allocations.filter((a) => a.id !== existing?.id).map((a) => a.qtyBase.toFixed()),
    );
    const poAllocated = sum(
      poLine.allocations.filter((a) => a.id !== existing?.id).map((a) => a.qtyBase.toFixed()),
    );
    const newQty = existing ? dec(existing.qtyBase.toFixed()).plus(qtyBase) : qtyBase;
    assertAllocation({
      qty: newQty,
      soLineOrdered: soLine.qtyBase.toFixed(),
      soLineTolerancePct: soLine.tolerancePct.toFixed(),
      soLineAllocated: soAllocated,
      poLineQty: poLine.qtyBase.toFixed(),
      poLineAllocated: poAllocated,
    });
    const allocation = existing
      ? await tx.orderAllocation.update({
          where: { id: existing.id },
          data: {
            qtyBase: newQty.toFixed(),
            isSubstitute,
            substituteNote: input.substituteNote ?? existing.substituteNote,
          },
        })
      : await tx.orderAllocation.create({
          data: {
            salesOrderLineId: soLine.id,
            purchaseOrderLineId: poLine.id,
            qtyBase: qtyBase.toFixed(),
            isSubstitute,
            substituteNote: input.substituteNote ?? null,
            createdById: actor.userId,
          },
        });
    await this.audit.log(tx, actor, {
      entityType: 'order_allocation',
      entityId: allocation.id,
      action: existing ? 'increase' : 'create',
      details: {
        salesOrder: soLine.salesOrder.number,
        soLine: soLine.lineNo,
        purchaseOrder: poLine.purchaseOrder.number,
        poLine: poLine.lineNo,
        qtyBase: qtyBase.toFixed(),
        totalQtyBase: newQty.toFixed(),
        isSubstitute,
      },
      reason: input.substituteNote,
    });
    await this.audit.activity(tx, actor, {
      eventType: 'allocation.created',
      entityType: 'order_allocation',
      entityId: allocation.id,
      salesOrderId: soLine.salesOrderId,
      purchaseOrderId: poLine.purchaseOrderId,
      customerId: soLine.salesOrder.customerId,
      supplierId: poLine.purchaseOrder.supplierId,
      summary: `${qtyBase.div(1000).toFixed()} MT of ${soLine.salesOrder.number} line ${soLine.lineNo} allocated to ${poLine.purchaseOrder.number} line ${poLine.lineNo}${isSubstitute ? ' (substitute spec)' : ''}`,
    });
    return allocation.id;
  }

  async allocate(actor: Actor, input: AllocationInput): Promise<AllocationDto> {
    const id = await this.prisma.tx((tx) => this.allocateInTx(tx, actor, input));
    return this.allocationById(actor, id);
  }

  private async allocationById(actor: Actor, id: string): Promise<AllocationDto> {
    const a = await this.prisma.orderAllocation.findUniqueOrThrow({
      where: { id },
      include: {
        ...allocationInclude,
        purchaseOrderLine: { include: { purchaseOrder: { include: { supplier: true } } } },
      },
    });
    const pl = a.purchaseOrderLine;
    const po = pl.purchaseOrder;
    const so = a.salesOrderLine.salesOrder;
    return {
      id: a.id,
      salesOrderLineId: a.salesOrderLineId,
      purchaseOrderLineId: a.purchaseOrderLineId,
      salesOrder: { id: so.id, code: so.number, name: so.number },
      purchaseOrder: { id: po.id, code: po.number, name: po.number },
      customer: refReq(so.customer),
      supplier: refReq(po.supplier),
      poStatus: po.status,
      soLineNo: a.salesOrderLine.lineNo,
      poLineNo: pl.lineNo,
      description: a.salesOrderLine.description,
      qtyBase: a.qtyBase.toFixed(),
      isSubstitute: a.isSubstitute,
      substituteNote: a.substituteNote,
      unitCostBase:
        canSeeCosts(actor) && !pl.qtyBase.isZero()
          ? pl.lineTotal.div(pl.qtyBase).toDecimalPlaces(6).toFixed()
          : null,
      poCurrency: po.currency,
      createdAt: tsReq(a.createdAt),
    };
  }

  /** Changes an allocation quantity; zero removes it. */
  async updateAllocation(
    actor: Actor,
    id: string,
    qty: string,
    uomCode: string,
    reason: string,
  ): Promise<AllocationDto | null> {
    const removed = await this.prisma.tx(async (tx) => {
      const a = await tx.orderAllocation.findFirst({
        where: {
          id,
          salesOrderLine: { salesOrder: { companyId: actor.companyId, ...viaCustomerScope(actor) } },
        },
        include: {
          ...allocationInclude,
          purchaseOrderLine: { include: { purchaseOrder: true, allocations: true } },
        },
      });
      if (!a) throw new NotFoundError('Allocation', id);
      await this.lockLines(tx, a.salesOrderLineId, a.purchaseOrderLineId);
      if (a.purchaseOrderLine.purchaseOrder.status === 'CLOSED')
        throw new BusinessRuleError('The purchase order is closed');
      const uom = await tx.uom.findUnique({ where: { code: uomCode } });
      if (!uom) throw new BusinessRuleError(`Unknown unit ${uomCode}`);
      const qtyBase = toBaseQty(qty, uom.factorToBase.toFixed());
      const so = a.salesOrderLine.salesOrder;
      const po = a.purchaseOrderLine.purchaseOrder;
      if (qtyBase.isZero()) {
        await tx.orderAllocation.delete({ where: { id } });
      } else {
        const soLine = await tx.salesOrderLine.findUniqueOrThrow({
          where: { id: a.salesOrderLineId },
          include: { allocations: true },
        });
        assertAllocation({
          qty: qtyBase,
          soLineOrdered: soLine.qtyBase.toFixed(),
          soLineTolerancePct: soLine.tolerancePct.toFixed(),
          soLineAllocated: sum(soLine.allocations.filter((x) => x.id !== id).map((x) => x.qtyBase.toFixed())),
          poLineQty: a.purchaseOrderLine.qtyBase.toFixed(),
          poLineAllocated: sum(
            a.purchaseOrderLine.allocations.filter((x) => x.id !== id).map((x) => x.qtyBase.toFixed()),
          ),
        });
        await tx.orderAllocation.update({ where: { id }, data: { qtyBase: qtyBase.toFixed() } });
      }
      await this.audit.log(tx, actor, {
        entityType: 'order_allocation',
        entityId: id,
        action: qtyBase.isZero() ? 'remove' : 'update',
        before: { qtyBase: a.qtyBase },
        after: { qtyBase: qtyBase.toFixed() },
        reason,
      });
      await this.audit.activity(tx, actor, {
        eventType: qtyBase.isZero() ? 'allocation.removed' : 'allocation.changed',
        entityType: 'order_allocation',
        entityId: id,
        salesOrderId: so.id,
        purchaseOrderId: po.id,
        customerId: so.customerId,
        supplierId: po.supplierId,
        summary: `Allocation ${so.number} ↔ ${po.number} ${qtyBase.isZero() ? 'removed' : `changed to ${qtyBase.div(1000).toFixed()} MT`}: ${reason}`,
      });
      return qtyBase.isZero();
    });
    return removed ? null : this.allocationById(actor, id);
  }

  /**
   * Back-to-back purchasing: creates one draft PO for a supplier covering the selected open
   * sales order lines and allocates each line in the same transaction.
   */
  async purchaseFromSales(actor: Actor, input: PurchaseFromSalesInput): Promise<PurchaseOrderDto> {
    const poId = await this.prisma.tx(async (tx) => {
      const { company, fxRate, data } = await this.header(tx, actor, input);
      const minor = await this.company.minorUnits(input.currency, tx);
      const uoms = new Map((await tx.uom.findMany()).map((u) => [u.code, u]));
      const soLines = await tx.salesOrderLine.findMany({
        where: {
          id: { in: input.lines.map((l) => l.salesOrderLineId) },
          salesOrder: { companyId: actor.companyId, status: 'CONFIRMED' },
        },
        include: { salesOrder: true },
      });
      const lineRows = input.lines.map((l, i) => {
        const so = soLines.find((s) => s.id === l.salesOrderLineId);
        if (!so) throw new BusinessRuleError(`Line ${i + 1}: sales order line not found or not confirmed`);
        const uom = uoms.get(l.uom);
        if (!uom || uom.dimension !== 'MASS')
          throw new BusinessRuleError(`Line ${i + 1}: unknown unit ${l.uom}`);
        const totals = computeLineTotals({ qty: l.qty, unitPrice: l.unitPrice }, minor);
        return {
          lineNo: i + 1,
          variantId: so.variantId,
          description: so.description,
          specSnapshot: so.specSnapshot as Prisma.InputJsonValue,
          packagingTypeId: so.packagingTypeId,
          qty: dec(l.qty).toFixed(),
          uom: l.uom,
          qtyBase: toBaseQty(l.qty, uom.factorToBase.toFixed()).toFixed(),
          unitPrice: dec(l.unitPrice).toFixed(),
          discountPct: '0',
          lineTotal: totals.net.toFixed(minor),
          expectedReadyDate: data.expectedReadyDate,
          notes: `For ${so.salesOrder.number} line ${so.lineNo}`,
        };
      });
      const totals = computeDocumentTotals(
        input.lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice })),
        {},
        minor,
      );
      const number = await this.sequences.next(tx, actor.companyId, 'PO', yearOf(input.poDate));
      const po = await tx.purchaseOrder.create({
        data: {
          ...data,
          companyId: actor.companyId,
          number,
          subtotal: totals.subtotal.toFixed(),
          discountTotal: totals.discountTotal.toFixed(),
          grandTotal: totals.grandTotal.toFixed(),
          grandTotalBase: toBase(totals.grandTotal, fxRate, company.baseMinorUnits).toFixed(),
          createdById: actor.userId,
          updatedById: actor.userId,
          lines: { create: lineRows },
        },
        include: { lines: { orderBy: { lineNo: 'asc' } }, supplier: true },
      });
      await this.audit.log(tx, actor, {
        entityType: 'purchase_order',
        entityId: po.id,
        action: 'create',
        after: po,
        details: undefined,
      });
      await this.audit.activity(tx, actor, {
        eventType: 'purchase_order.created',
        entityType: 'purchase_order',
        entityId: po.id,
        purchaseOrderId: po.id,
        supplierId: po.supplierId,
        summary: `Purchase order ${po.number} created for ${po.supplier.companyName} from ${[...new Set(soLines.map((s) => s.salesOrder.number))].join(', ')}`,
      });
      for (const [i, l] of input.lines.entries()) {
        const poLine = po.lines[i]!;
        await this.allocateInTx(tx, actor, {
          salesOrderLineId: l.salesOrderLineId,
          purchaseOrderLineId: poLine.id,
          qty: l.qty,
          uom: l.uom,
          substituteNote: null,
        });
      }
      return po.id;
    });
    return this.get(actor, poId);
  }

  /** Open PO lines with unallocated quantity for a variant, to allocate an SO line from existing supply. */
  async openSupply(actor: Actor, variantId?: string, productId?: string) {
    const lines = await this.prisma.purchaseOrderLine.findMany({
      where: {
        lineStatus: 'OPEN',
        purchaseOrder: { companyId: actor.companyId, status: { notIn: ['CANCELLED', 'CLOSED'] } },
        ...(variantId ? { variantId } : {}),
        ...(productId ? { variant: { productId } } : {}),
      },
      include: { purchaseOrder: { include: { supplier: true } }, allocations: true, variant: true },
      orderBy: { purchaseOrder: { poDate: 'desc' } },
      take: 200,
    });
    const showCost = canSeeCosts(actor);
    return lines
      .map((l) => {
        const allocated = sum(l.allocations.map((a) => a.qtyBase.toFixed()));
        return {
          purchaseOrderLineId: l.id,
          purchaseOrder: {
            id: l.purchaseOrder.id,
            code: l.purchaseOrder.number,
            name: l.purchaseOrder.number,
          },
          supplier: refReq(l.purchaseOrder.supplier),
          poStatus: l.purchaseOrder.status,
          lineNo: l.lineNo,
          variantId: l.variantId,
          description: l.description,
          qtyBase: l.qtyBase.toFixed(),
          unallocatedQtyBase: dec(l.qtyBase.toFixed()).minus(allocated).toFixed(),
          unitPrice: showCost ? l.unitPrice.toFixed() : null,
          uom: l.uom,
          currency: l.purchaseOrder.currency,
          expectedReadyDate: day(
            l.expectedReadyDate ?? l.purchaseOrder.confirmedReadyDate ?? l.purchaseOrder.expectedReadyDate,
          ),
        };
      })
      .filter((l) => new Decimal(l.unallocatedQtyBase).gt(0));
  }
}
