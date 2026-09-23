import { Injectable } from '@nestjs/common';
import type {
  AddressInput,
  ContactInput,
  CreateCustomerInput,
  CreditExposureDto,
  CustomerDto,
  CustomerListItemDto,
  ListQuery,
  Page,
  UpdateCustomerInput,
} from '@fillco/contracts';
import { Prisma } from '@fillco/db';
import { Actor, can } from '../../common/actor';
import { AuditService } from '../../common/audit.service';
import { assertVersion, BusinessRuleError, ForbiddenError, NotFoundError } from '../../common/errors';
import { contains, orderBy, page, paging } from '../../common/list';
import { PrismaService, Tx } from '../../common/prisma.service';
import { customerScope } from '../../common/scope';
import { SequenceService } from '../../common/sequence.service';
import { ref, tsReq } from '../../common/serialize';
import { CreditService } from './credit.service';
import { addressDto, contactDto } from './party-mappers';

const detailInclude = {
  paymentTerm: true,
  salesperson: true,
  contacts: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] },
  addresses: { orderBy: [{ type: 'asc' }, { isDefault: 'desc' }] },
} satisfies Prisma.CustomerInclude;
type CustomerRow = Prisma.CustomerGetPayload<{ include: typeof detailInclude }>;

const listInclude = { paymentTerm: true, salesperson: true } satisfies Prisma.CustomerInclude;
type CustomerListRow = Prisma.CustomerGetPayload<{ include: typeof listInclude }>;

export interface CustomerFilter extends ListQuery {
  status?: string;
  countryCode?: string;
  salespersonId?: string;
}

const CREDIT_STATUSES = new Set(['ON_HOLD', 'BLOCKED']);

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
    private readonly credit: CreditService,
  ) {}

  private async portRef(id: string | null) {
    if (!id) return null;
    return ref(await this.prisma.port.findUnique({ where: { id } }));
  }

  private async toDto(c: CustomerRow): Promise<CustomerDto> {
    return {
      id: c.id,
      code: c.code,
      companyName: c.companyName,
      legalName: c.legalName,
      countryCode: c.countryCode,
      city: c.city,
      address: c.address,
      phone: c.phone,
      email: c.email,
      whatsapp: c.whatsapp,
      website: c.website,
      taxId: c.taxId,
      vatNumber: c.vatNumber,
      defaultCurrency: c.defaultCurrency,
      paymentTerm: ref(c.paymentTerm),
      creditLimit: c.creditLimit.toFixed(2),
      creditLimitCurrency: c.creditLimitCurrency,
      defaultIncoterm: c.defaultIncoterm,
      defaultDestinationPort: await this.portRef(c.defaultDestinationPortId),
      salesperson: ref(c.salesperson),
      status: c.status,
      notes: c.notes,
      contacts: c.contacts.map(contactDto),
      addresses: c.addresses.map(addressDto),
      createdAt: tsReq(c.createdAt),
      updatedAt: tsReq(c.updatedAt),
      version: c.version,
    };
  }

  listItem(c: CustomerListRow): CustomerListItemDto {
    return {
      id: c.id,
      code: c.code,
      companyName: c.companyName,
      countryCode: c.countryCode,
      city: c.city,
      status: c.status,
      defaultCurrency: c.defaultCurrency,
      paymentTerm: c.paymentTerm?.name ?? null,
      paymentTermId: c.paymentTermId,
      defaultIncoterm: c.defaultIncoterm,
      defaultDestinationPortId: c.defaultDestinationPortId,
      creditLimit: c.creditLimit.toFixed(2),
      creditLimitCurrency: c.creditLimitCurrency,
      salesperson: c.salesperson?.fullName ?? null,
      phone: c.phone,
      email: c.email,
    };
  }

  async list(
    actor: Actor,
    q: CustomerFilter,
  ): Promise<{ page: Page<CustomerListItemDto>; rows: CustomerListItemDto[] }> {
    const where: Prisma.CustomerWhereInput = {
      ...customerScope(actor),
      ...(q.status ? { status: q.status as Prisma.EnumCustomerStatusFilter['equals'] } : {}),
      ...(q.countryCode ? { countryCode: q.countryCode.toUpperCase() } : {}),
      ...(q.salespersonId ? { salespersonId: q.salespersonId } : {}),
      ...(q.q
        ? {
            OR: [
              { companyName: contains(q.q) },
              { code: contains(q.q) },
              { email: contains(q.q) },
              { phone: contains(q.q) },
              { city: contains(q.q) },
              {
                contacts: {
                  some: { OR: [{ name: contains(q.q) }, { email: contains(q.q) }, { phone: contains(q.q) }] },
                },
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        include: listInclude,
        orderBy: orderBy(
          q.sort,
          {
            code: (dir) => ({ code: dir }),
            companyName: (dir) => ({ companyName: dir }),
            countryCode: (dir) => ({ countryCode: dir }),
            creditLimit: (dir) => ({ creditLimit: dir }),
            status: (dir) => ({ status: dir }),
            createdAt: (dir) => ({ createdAt: dir }),
          },
          { companyName: 'asc' },
        ) as Prisma.CustomerOrderByWithRelationInput[],
        ...paging(q),
      }),
      this.prisma.customer.count({ where }),
    ]);
    const items = rows.map((r) => this.listItem(r));
    return { page: page(items, total, q), rows: items };
  }

  /** Loads a customer the actor may see, or throws 404 (not 403, to avoid leaking existence). */
  async findVisible(actor: Actor, id: string, tx: Tx = this.prisma): Promise<CustomerRow> {
    const c = await tx.customer.findFirst({ where: { id, ...customerScope(actor) }, include: detailInclude });
    if (!c) throw new NotFoundError('Customer', id);
    return c;
  }

  async get(actor: Actor, id: string): Promise<CustomerDto> {
    return this.toDto(await this.findVisible(actor, id));
  }

  private assertCreditFields(
    actor: Actor,
    input: { creditLimit?: string; creditLimitCurrency?: string; status?: string },
    current?: CustomerRow,
  ) {
    const limitChanged =
      input.creditLimit !== undefined &&
      (current ? !current.creditLimit.eq(input.creditLimit) : Number(input.creditLimit) !== 0);
    const limitCurrencyChanged =
      current &&
      input.creditLimitCurrency !== undefined &&
      input.creditLimitCurrency !== current.creditLimitCurrency;
    if ((limitChanged || limitCurrencyChanged) && !can(actor, 'customer.credit_limit.edit')) {
      throw new ForbiddenError('Only credit controllers can set or change credit limits');
    }
    if (input.status && input.status !== current?.status) {
      const touchesCredit =
        CREDIT_STATUSES.has(input.status) || (current && CREDIT_STATUSES.has(current.status));
      if (touchesCredit && !can(actor, 'customer.credit_limit.edit')) {
        throw new ForbiddenError('Only credit controllers can put customers on hold or block them');
      }
      const touchesArchive = input.status === 'INACTIVE' || current?.status === 'INACTIVE';
      if (touchesArchive && !can(actor, 'customer.archive'))
        throw new ForbiddenError('You cannot archive customers');
    }
  }

  private resolveSalesperson(
    actor: Actor,
    requested: string | null | undefined,
    current?: string | null,
  ): string | null | undefined {
    if (can(actor, 'customer.view_all')) return requested;
    // Scoped salespeople own what they create and cannot hand customers to someone else.
    if (!current) return actor.userId;
    if (requested !== undefined && requested !== current)
      throw new ForbiddenError('You cannot reassign customers');
    return undefined;
  }

  async create(actor: Actor, input: CreateCustomerInput): Promise<CustomerDto> {
    this.assertCreditFields(actor, input);
    const salespersonId = this.resolveSalesperson(actor, input.salespersonId);
    const created = await this.prisma.tx(async (tx) => {
      const code = await this.sequences.next(tx, actor.companyId, 'CUST', 0);
      const { contacts, addresses, ...fields } = input;
      const c = await tx.customer.create({
        data: {
          ...fields,
          companyId: actor.companyId,
          code,
          creditLimitCurrency: input.creditLimitCurrency ?? input.defaultCurrency,
          salespersonId: salespersonId ?? null,
          createdById: actor.userId,
          updatedById: actor.userId,
          contacts: { create: normalizePrimary(contacts) },
          addresses: { create: normalizeDefaults(addresses) },
        },
        include: detailInclude,
      });
      await this.audit.log(tx, actor, { entityType: 'customer', entityId: c.id, action: 'create', after: c });
      await this.audit.activity(tx, actor, {
        eventType: 'customer.created',
        entityType: 'customer',
        entityId: c.id,
        customerId: c.id,
        summary: `Customer ${c.code} ${c.companyName} created`,
      });
      await this.audit.outbox(tx, 'customer.created', 'customer', c.id, {
        code: c.code,
        companyName: c.companyName,
      });
      return c;
    });
    return this.toDto(created);
  }

  async update(actor: Actor, id: string, input: UpdateCustomerInput): Promise<CustomerDto> {
    const current = await this.findVisible(actor, id);
    assertVersion('Customer', current.version, input.version);
    this.assertCreditFields(actor, input, current);
    const salespersonId = this.resolveSalesperson(actor, input.salespersonId, current.salespersonId);
    const { version: _v, ...fields } = input;
    const updated = await this.prisma.tx(async (tx) => {
      const c = await tx.customer.update({
        where: { id },
        data: { ...fields, salespersonId, updatedById: actor.userId, version: { increment: 1 } },
        include: detailInclude,
      });
      await this.audit.log(tx, actor, {
        entityType: 'customer',
        entityId: id,
        action: 'update',
        before: current,
        after: c,
      });
      if (current.status !== c.status || !current.creditLimit.eq(c.creditLimit)) {
        await this.audit.activity(tx, actor, {
          eventType: 'customer.credit_changed',
          entityType: 'customer',
          entityId: id,
          customerId: id,
          summary: `Credit settings changed: ${current.status} → ${c.status}, limit ${current.creditLimit.toFixed(2)} → ${c.creditLimit.toFixed(2)} ${c.creditLimitCurrency}`,
        });
      }
      return c;
    });
    return this.toDto(updated);
  }

  async exposure(actor: Actor, id: string): Promise<CreditExposureDto> {
    await this.findVisible(actor, id);
    return this.credit.toDto(await this.credit.exposure(actor.companyId, id));
  }

  // ───────────── Contacts & addresses ─────────────

  async addContact(actor: Actor, customerId: string, input: ContactInput): Promise<CustomerDto> {
    await this.findVisible(actor, customerId);
    await this.prisma.tx(async (tx) => {
      if (input.isPrimary)
        await tx.customerContact.updateMany({ where: { customerId }, data: { isPrimary: false } });
      const c = await tx.customerContact.create({ data: { ...input, customerId } });
      await this.audit.log(tx, actor, {
        entityType: 'customer',
        entityId: customerId,
        action: 'contact_added',
        after: c,
      });
    });
    return this.get(actor, customerId);
  }

  async updateContact(
    actor: Actor,
    customerId: string,
    contactId: string,
    input: ContactInput,
  ): Promise<CustomerDto> {
    await this.findVisible(actor, customerId);
    await this.prisma.tx(async (tx) => {
      const before = await tx.customerContact.findFirst({ where: { id: contactId, customerId } });
      if (!before) throw new NotFoundError('Contact', contactId);
      if (input.isPrimary)
        await tx.customerContact.updateMany({ where: { customerId }, data: { isPrimary: false } });
      const after = await tx.customerContact.update({ where: { id: contactId }, data: input });
      await this.audit.log(tx, actor, {
        entityType: 'customer',
        entityId: customerId,
        action: 'contact_updated',
        before,
        after,
      });
    });
    return this.get(actor, customerId);
  }

  async deleteContact(actor: Actor, customerId: string, contactId: string): Promise<CustomerDto> {
    await this.findVisible(actor, customerId);
    await this.prisma.tx(async (tx) => {
      const before = await tx.customerContact.findFirst({ where: { id: contactId, customerId } });
      if (!before) throw new NotFoundError('Contact', contactId);
      await tx.customerContact.delete({ where: { id: contactId } });
      await this.audit.log(tx, actor, {
        entityType: 'customer',
        entityId: customerId,
        action: 'contact_removed',
        before,
        after: null,
      });
    });
    return this.get(actor, customerId);
  }

  async addAddress(actor: Actor, customerId: string, input: AddressInput): Promise<CustomerDto> {
    await this.findVisible(actor, customerId);
    await this.prisma.tx(async (tx) => {
      if (input.isDefault)
        await tx.customerAddress.updateMany({
          where: { customerId, type: input.type },
          data: { isDefault: false },
        });
      const a = await tx.customerAddress.create({ data: { ...input, customerId } });
      await this.audit.log(tx, actor, {
        entityType: 'customer',
        entityId: customerId,
        action: 'address_added',
        after: a,
      });
    });
    return this.get(actor, customerId);
  }

  async updateAddress(
    actor: Actor,
    customerId: string,
    addressId: string,
    input: AddressInput,
  ): Promise<CustomerDto> {
    await this.findVisible(actor, customerId);
    await this.prisma.tx(async (tx) => {
      const before = await tx.customerAddress.findFirst({ where: { id: addressId, customerId } });
      if (!before) throw new NotFoundError('Address', addressId);
      if (input.isDefault)
        await tx.customerAddress.updateMany({
          where: { customerId, type: input.type },
          data: { isDefault: false },
        });
      const after = await tx.customerAddress.update({ where: { id: addressId }, data: input });
      await this.audit.log(tx, actor, {
        entityType: 'customer',
        entityId: customerId,
        action: 'address_updated',
        before,
        after,
      });
    });
    return this.get(actor, customerId);
  }

  async deleteAddress(actor: Actor, customerId: string, addressId: string): Promise<CustomerDto> {
    await this.findVisible(actor, customerId);
    const used = await this.prisma.salesOrder.count({
      where: { OR: [{ shippingAddressId: addressId }, { billingAddressId: addressId }] },
    });
    if (used > 0) throw new BusinessRuleError('This address is used on sales orders and cannot be removed');
    await this.prisma.tx(async (tx) => {
      const before = await tx.customerAddress.findFirst({ where: { id: addressId, customerId } });
      if (!before) throw new NotFoundError('Address', addressId);
      await tx.customerAddress.delete({ where: { id: addressId } });
      await this.audit.log(tx, actor, {
        entityType: 'customer',
        entityId: customerId,
        action: 'address_removed',
        before,
        after: null,
      });
    });
    return this.get(actor, customerId);
  }
}

/** Exactly one primary contact: the first one flagged, otherwise the first one. */
export function normalizePrimary<T extends { isPrimary: boolean }>(items: T[]): T[] {
  const primary = Math.max(
    items.findIndex((i) => i.isPrimary),
    0,
  );
  return items.map((i, idx) => ({ ...i, isPrimary: idx === primary }));
}

/** Exactly one default address per type: the first one flagged, otherwise the first of that type. */
export function normalizeDefaults<T extends { isDefault: boolean; type: string }>(items: T[]): T[] {
  const chosen = new Map<string, number>();
  items.forEach((i, idx) => {
    if (i.isDefault && !chosen.has(i.type)) chosen.set(i.type, idx);
  });
  items.forEach((i, idx) => {
    if (!chosen.has(i.type)) chosen.set(i.type, idx);
  });
  return items.map((i, idx) => ({ ...i, isDefault: chosen.get(i.type) === idx }));
}
