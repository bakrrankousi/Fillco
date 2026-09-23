import { Injectable } from '@nestjs/common';
import type {
  ListQuery,
  Page,
  QuotationDto,
  QuotationInput,
  QuotationLineDto,
  QuotationListItemDto,
  UpdateQuotationInput,
} from '@fillco/contracts';
import { Prisma } from '@fillco/db';
import { dec, isoToDate, roundTo, yearOf } from '@fillco/domain';
import type { Actor } from '../../common/actor';
import { AuditService } from '../../common/audit.service';
import { CompanyService } from '../../common/company.service';
import { assertVersion, BusinessRuleError, NotFoundError } from '../../common/errors';
import { contains, orderBy, page, paging } from '../../common/list';
import { PrismaService, Tx } from '../../common/prisma.service';
import { canSeeCosts, viaCustomerScope } from '../../common/scope';
import { SequenceService } from '../../common/sequence.service';
import { day, dayReq, ref, refReq, ts, tsReq } from '../../common/serialize';
import { DocumentLinesService } from '../catalog/document-lines.service';
import { CustomersService } from '../parties/customers.service';
import { termSummary } from '../settings/settings.service';
import { SalesOrdersService } from './sales-orders.service';

const lineInclude = { variant: { include: { product: true } } } satisfies Prisma.QuotationLineInclude;
const include = {
  customer: true,
  salesperson: true,
  paymentTerm: { include: { installments: { orderBy: { seq: 'asc' } } } },
  lines: { include: lineInclude, orderBy: { lineNo: 'asc' } },
  salesOrders: true,
} satisfies Prisma.QuotationInclude;
type QuotationRow = Prisma.QuotationGetPayload<{ include: typeof include }>;

export interface QuotationFilter extends ListQuery {
  status?: string;
  customerId?: string;
}

const OPEN_STATUSES = new Set(['DRAFT', 'SENT']);

@Injectable()
export class QuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
    private readonly company: CompanyService,
    private readonly lines: DocumentLinesService,
    private readonly customers: CustomersService,
    private readonly salesOrders: SalesOrdersService,
  ) {}

  private isExpired(q: { status: string; validUntil: Date }, today: string): boolean {
    return OPEN_STATUSES.has(q.status) && dayReq(q.validUntil) < today;
  }

  private async toDto(actor: Actor, q: QuotationRow): Promise<QuotationDto> {
    const company = await this.company.get(actor.companyId);
    const today = this.company.today(company);
    const packaging = await DocumentLinesService.packagingMap(this.prisma);
    const ports = new Map(
      (
        await this.prisma.port.findMany({
          where: { id: { in: [q.loadingPortId, q.destinationPortId].filter((x): x is string => !!x) } },
        })
      ).map((p) => [p.id, p]),
    );
    const showCost = canSeeCosts(actor);
    const revisions = await this.prisma.quotation.findMany({
      where: { companyId: q.companyId, number: q.number },
      orderBy: { revision: 'asc' },
    });
    const lines: QuotationLineDto[] = q.lines.map((l) => {
      const base = DocumentLinesService.toDto(l, packaging);
      const sameCurrency = !l.estCostCurrency || l.estCostCurrency === q.currency;
      // Margin on the net selling price: (net price − estimated cost) / net price.
      const netPrice = dec(l.unitPrice.toFixed()).times(dec(100).minus(l.discountPct.toFixed())).div(100);
      const margin =
        showCost && l.estUnitCost && sameCurrency && !netPrice.isZero()
          ? roundTo(netPrice.minus(l.estUnitCost.toFixed()).div(netPrice).times(100), 1).toFixed()
          : null;
      return {
        ...base,
        estUnitCost: showCost ? (l.estUnitCost?.toFixed() ?? null) : null,
        estCostCurrency: showCost ? l.estCostCurrency : null,
        estMarginPct: margin,
      };
    });
    return {
      id: q.id,
      number: q.number,
      revision: q.revision,
      customer: refReq(q.customer),
      salesperson: ref(q.salesperson),
      quotationDate: dayReq(q.quotationDate),
      validUntil: dayReq(q.validUntil),
      currency: q.currency,
      incoterm: q.incoterm,
      loadingPort: ref(q.loadingPortId ? ports.get(q.loadingPortId) : null),
      destinationCountry: q.destinationCountry,
      destinationPort: ref(q.destinationPortId ? ports.get(q.destinationPortId) : null),
      paymentTerm: ref(q.paymentTerm),
      paymentTermSummary: q.paymentTerm ? termSummary(q.paymentTerm) : null,
      estimatedShipmentDate: day(q.estimatedShipmentDate),
      status: q.status,
      notes: q.notes,
      internalNotes: q.internalNotes,
      subtotal: q.subtotal.toFixed(),
      discountTotal: q.discountTotal.toFixed(),
      grandTotal: q.grandTotal.toFixed(),
      lines,
      revisions: revisions.map((r) => ({
        id: r.id,
        revision: r.revision,
        status: r.status,
        quotationDate: dayReq(r.quotationDate),
        grandTotal: r.grandTotal.toFixed(),
      })),
      salesOrders: q.salesOrders.map((s) => ({ id: s.id, code: s.number, name: s.number })),
      sentAt: ts(q.sentAt),
      decidedAt: ts(q.decidedAt),
      decisionNote: q.decisionNote,
      isExpired: this.isExpired(q, today),
      createdAt: tsReq(q.createdAt),
      version: q.version,
    };
  }

  async list(
    actor: Actor,
    q: QuotationFilter,
  ): Promise<{ page: Page<QuotationListItemDto>; rows: QuotationListItemDto[] }> {
    const company = await this.company.get(actor.companyId);
    const today = this.company.today(company);
    const where: Prisma.QuotationWhereInput = {
      companyId: actor.companyId,
      ...viaCustomerScope(actor),
      ...(q.status
        ? { status: q.status as Prisma.EnumQuotationStatusFilter['equals'] }
        : { status: { not: 'SUPERSEDED' } }),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.q ? { OR: [{ number: contains(q.q) }, { customer: { companyName: contains(q.q) } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.quotation.findMany({
        where,
        include: { customer: true, salesperson: true },
        orderBy: orderBy(
          q.sort,
          {
            number: (dir) => ({ number: dir }),
            quotationDate: (dir) => ({ quotationDate: dir }),
            validUntil: (dir) => ({ validUntil: dir }),
            grandTotal: (dir) => ({ grandTotal: dir }),
            status: (dir) => ({ status: dir }),
            customer: (dir) => ({ customer: { companyName: dir } }),
          },
          { createdAt: 'desc' },
        ) as Prisma.QuotationOrderByWithRelationInput[],
        ...paging(q),
      }),
      this.prisma.quotation.count({ where }),
    ]);
    const items: QuotationListItemDto[] = rows.map((r) => ({
      id: r.id,
      number: r.number,
      revision: r.revision,
      customer: refReq(r.customer),
      quotationDate: dayReq(r.quotationDate),
      validUntil: dayReq(r.validUntil),
      currency: r.currency,
      grandTotal: r.grandTotal.toFixed(),
      status: r.status,
      salesperson: r.salesperson?.fullName ?? null,
      isExpired: this.isExpired(r, today),
    }));
    return { page: page(items, total, q), rows: items };
  }

  private async find(actor: Actor, id: string, tx: Tx = this.prisma): Promise<QuotationRow> {
    const q = await tx.quotation.findFirst({
      where: { id, companyId: actor.companyId, ...viaCustomerScope(actor) },
      include,
    });
    if (!q) throw new NotFoundError('Quotation', id);
    return q;
  }

  async get(actor: Actor, id: string): Promise<QuotationDto> {
    return this.toDto(actor, await this.find(actor, id));
  }

  private async prepare(tx: Tx, actor: Actor, input: QuotationInput) {
    await this.customers.findVisible(actor, input.customerId, tx);
    if (input.validUntil < input.quotationDate) {
      throw new BusinessRuleError(
        'Validity must end on or after the quotation date',
        'VALIDATION',
        undefined,
        {
          validUntil: ['Must be on or after the quotation date'],
        },
      );
    }
    const doc = await this.lines.prepare(tx, input.currency, input.lines);
    const showCost = canSeeCosts(actor);
    const header = {
      customerId: input.customerId,
      salespersonId: input.salespersonId ?? actor.userId,
      quotationDate: isoToDate(input.quotationDate),
      validUntil: isoToDate(input.validUntil),
      currency: input.currency,
      incoterm: input.incoterm ?? null,
      loadingPortId: input.loadingPortId ?? null,
      destinationCountry: input.destinationCountry ?? null,
      destinationPortId: input.destinationPortId ?? null,
      paymentTermId: input.paymentTermId ?? null,
      estimatedShipmentDate: input.estimatedShipmentDate ? isoToDate(input.estimatedShipmentDate) : null,
      notes: input.notes ?? null,
      internalNotes: input.internalNotes ?? null,
      subtotal: doc.totals.subtotal.toFixed(),
      discountTotal: doc.totals.discountTotal.toFixed(),
      grandTotal: doc.totals.grandTotal.toFixed(),
    };
    const lineData = doc.lines.map((l, i) => ({
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
      notes: l.notes,
      estUnitCost: showCost ? (input.lines[i]?.estUnitCost ?? null) : null,
      estCostCurrency: showCost ? (input.lines[i]?.estCostCurrency ?? input.currency) : null,
    }));
    return { header, lineData };
  }

  async create(actor: Actor, input: QuotationInput): Promise<QuotationDto> {
    const created = await this.prisma.tx(async (tx) => {
      const { header, lineData } = await this.prepare(tx, actor, input);
      const number = await this.sequences.next(tx, actor.companyId, 'QT', yearOf(input.quotationDate));
      const q = await tx.quotation.create({
        data: {
          ...header,
          companyId: actor.companyId,
          number,
          createdById: actor.userId,
          updatedById: actor.userId,
          lines: { create: lineData },
        },
        include,
      });
      await this.audit.log(tx, actor, {
        entityType: 'quotation',
        entityId: q.id,
        action: 'create',
        after: q,
      });
      await this.audit.activity(tx, actor, {
        eventType: 'quotation.created',
        entityType: 'quotation',
        entityId: q.id,
        quotationId: q.id,
        customerId: q.customerId,
        summary: `Quotation ${q.number} created (${q.currency} ${q.grandTotal.toFixed(2)})`,
      });
      return q;
    });
    return this.toDto(actor, created);
  }

  async update(actor: Actor, id: string, input: UpdateQuotationInput): Promise<QuotationDto> {
    const updated = await this.prisma.tx(async (tx) => {
      const current = await this.find(actor, id, tx);
      assertVersion('Quotation', current.version, input.version);
      if (current.status !== 'DRAFT') {
        throw new BusinessRuleError(
          'Only draft quotations can be edited. Create a revision of a sent quotation.',
          'NOT_DRAFT',
        );
      }
      const { header, lineData } = await this.prepare(tx, actor, input);
      await tx.quotationLine.deleteMany({ where: { quotationId: id } });
      const q = await tx.quotation.update({
        where: { id },
        data: {
          ...header,
          updatedById: actor.userId,
          version: { increment: 1 },
          lines: { create: lineData },
        },
        include,
      });
      await this.audit.log(tx, actor, {
        entityType: 'quotation',
        entityId: id,
        action: 'update',
        before: current,
        after: q,
      });
      return q;
    });
    return this.toDto(actor, updated);
  }

  private async transition(
    actor: Actor,
    id: string,
    from: readonly string[],
    to: 'SENT' | 'ACCEPTED' | 'REJECTED',
    note?: string | null,
  ): Promise<QuotationDto> {
    const updated = await this.prisma.tx(async (tx) => {
      const current = await this.find(actor, id, tx);
      if (!from.includes(current.status))
        throw new BusinessRuleError(`Quotation is ${current.status}; cannot mark as ${to}`);
      const company = await this.company.get(actor.companyId, tx);
      if (to !== 'REJECTED' && this.isExpired(current, this.company.today(company))) {
        throw new BusinessRuleError(
          'This quotation has expired. Create a revision with a new validity date.',
          'EXPIRED',
        );
      }
      const q = await tx.quotation.update({
        where: { id },
        data: {
          status: to,
          ...(to === 'SENT' ? { sentAt: new Date() } : { decidedAt: new Date(), decisionNote: note ?? null }),
          updatedById: actor.userId,
          version: { increment: 1 },
        },
        include,
      });
      await this.audit.log(tx, actor, {
        entityType: 'quotation',
        entityId: id,
        action: to.toLowerCase(),
        before: { status: current.status },
        after: { status: to },
        reason: note,
      });
      await this.audit.activity(tx, actor, {
        eventType: `quotation.${to.toLowerCase()}`,
        entityType: 'quotation',
        entityId: id,
        quotationId: id,
        customerId: q.customerId,
        summary: `Quotation ${q.number} rev ${q.revision} ${to === 'SENT' ? 'sent to customer' : to.toLowerCase()}`,
      });
      return q;
    });
    return this.toDto(actor, updated);
  }

  send(actor: Actor, id: string) {
    return this.transition(actor, id, ['DRAFT'], 'SENT');
  }

  accept(actor: Actor, id: string, note?: string | null) {
    return this.transition(actor, id, ['SENT'], 'ACCEPTED', note);
  }

  reject(actor: Actor, id: string, note?: string | null) {
    return this.transition(actor, id, ['SENT', 'ACCEPTED'], 'REJECTED', note);
  }

  /** Copies a sent/rejected/expired quotation into a new draft revision; the old one is kept as SUPERSEDED. */
  async revise(actor: Actor, id: string): Promise<QuotationDto> {
    const created = await this.prisma.tx(async (tx) => {
      const current = await this.find(actor, id, tx);
      if (!['SENT', 'REJECTED', 'EXPIRED', 'ACCEPTED'].includes(current.status)) {
        throw new BusinessRuleError(`A ${current.status.toLowerCase()} quotation cannot be revised`);
      }
      const company = await this.company.get(actor.companyId, tx);
      const today = this.company.today(company);
      const validityDays = Math.max(
        1,
        Math.round((current.validUntil.getTime() - current.quotationDate.getTime()) / 86_400_000),
      );
      await tx.quotation.update({ where: { id }, data: { status: 'SUPERSEDED', version: { increment: 1 } } });
      const q = await tx.quotation.create({
        data: {
          companyId: current.companyId,
          number: current.number,
          revision: current.revision + 1,
          previousRevisionId: current.id,
          customerId: current.customerId,
          salespersonId: current.salespersonId,
          quotationDate: isoToDate(today),
          validUntil: new Date(isoToDate(today).getTime() + validityDays * 86_400_000),
          currency: current.currency,
          incoterm: current.incoterm,
          loadingPortId: current.loadingPortId,
          destinationCountry: current.destinationCountry,
          destinationPortId: current.destinationPortId,
          paymentTermId: current.paymentTermId,
          estimatedShipmentDate: current.estimatedShipmentDate,
          notes: current.notes,
          internalNotes: current.internalNotes,
          subtotal: current.subtotal,
          discountTotal: current.discountTotal,
          grandTotal: current.grandTotal,
          createdById: actor.userId,
          updatedById: actor.userId,
          lines: {
            create: current.lines.map((l) => ({
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
              estUnitCost: l.estUnitCost,
              estCostCurrency: l.estCostCurrency,
              notes: l.notes,
            })),
          },
        },
        include,
      });
      await this.audit.log(tx, actor, {
        entityType: 'quotation',
        entityId: q.id,
        action: 'revise',
        details: { from: current.id, revision: q.revision },
      });
      await this.audit.activity(tx, actor, {
        eventType: 'quotation.revised',
        entityType: 'quotation',
        entityId: q.id,
        quotationId: q.id,
        customerId: q.customerId,
        summary: `Quotation ${q.number} revised to rev ${q.revision}`,
      });
      return q;
    });
    return this.toDto(actor, created);
  }

  /** Deleting a draft revision restores the revision it replaced. */
  async delete(actor: Actor, id: string): Promise<void> {
    await this.prisma.tx(async (tx) => {
      const current = await this.find(actor, id, tx);
      if (current.status !== 'DRAFT') throw new BusinessRuleError('Only draft quotations can be deleted');
      await tx.quotation.delete({ where: { id } });
      if (current.previousRevisionId) {
        await tx.quotation.update({
          where: { id: current.previousRevisionId },
          data: { status: 'SENT', version: { increment: 1 } },
        });
      }
      await this.audit.log(tx, actor, {
        entityType: 'quotation',
        entityId: id,
        action: 'delete',
        before: current,
        after: null,
      });
    });
  }

  /** Converts a sent/accepted quotation into a draft sales order with the same lines. */
  async convert(actor: Actor, id: string): Promise<{ salesOrderId: string }> {
    return this.prisma.tx(async (tx) => {
      const q = await this.find(actor, id, tx);
      if (!['SENT', 'ACCEPTED'].includes(q.status)) {
        throw new BusinessRuleError(
          `Only sent or accepted quotations can be converted (this one is ${q.status})`,
        );
      }
      const company = await this.company.get(actor.companyId, tx);
      if (this.isExpired(q, this.company.today(company)) && q.status !== 'ACCEPTED') {
        throw new BusinessRuleError(
          'This quotation has expired. Mark it accepted or create a revision first.',
          'EXPIRED',
        );
      }
      const so = await this.salesOrders.createFromQuotation(tx, actor, q);
      await tx.quotation.update({
        where: { id },
        data: { status: 'CONVERTED', decidedAt: q.decidedAt ?? new Date(), version: { increment: 1 } },
      });
      await this.audit.log(tx, actor, {
        entityType: 'quotation',
        entityId: id,
        action: 'convert',
        details: { salesOrderId: so.id, salesOrderNumber: so.number },
      });
      await this.audit.activity(tx, actor, {
        eventType: 'quotation.converted',
        entityType: 'quotation',
        entityId: id,
        quotationId: id,
        salesOrderId: so.id,
        customerId: q.customerId,
        summary: `Quotation ${q.number} rev ${q.revision} converted to sales order ${so.number}`,
      });
      return { salesOrderId: so.id };
    });
  }
}
