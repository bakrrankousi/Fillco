import { Injectable } from '@nestjs/common';
import type {
  AddressInput,
  BankAccountDto,
  BankAccountInput,
  ContactInput,
  CreateSupplierInput,
  ListQuery,
  Page,
  SupplierDto,
  SupplierListItemDto,
  UpdateSupplierInput,
} from '@fillco/contracts';
import { Prisma } from '@fillco/db';
import { Actor, can } from '../../common/actor';
import { AuditService } from '../../common/audit.service';
import { assertVersion, BusinessRuleError, ForbiddenError, NotFoundError } from '../../common/errors';
import { contains, orderBy, page, paging } from '../../common/list';
import { PrismaService } from '../../common/prisma.service';
import { SequenceService } from '../../common/sequence.service';
import { ref, ts, tsReq } from '../../common/serialize';
import { normalizeDefaults, normalizePrimary } from './customers.service';
import { addressDto, contactDto } from './party-mappers';

const detailInclude = {
  paymentTerm: true,
  contacts: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] },
  addresses: { orderBy: [{ type: 'asc' }, { isDefault: 'desc' }] },
  bankAccounts: { include: { approvedBy: true }, orderBy: { createdAt: 'desc' } },
} satisfies Prisma.SupplierInclude;
type SupplierRow = Prisma.SupplierGetPayload<{ include: typeof detailInclude }>;
type BankRow = SupplierRow['bankAccounts'][number];

export interface SupplierFilter extends ListQuery {
  status?: string;
  supplierType?: string;
  countryCode?: string;
}

/** Masks all but the last 4 characters of an account identifier. */
function mask(value: string | null): string | null {
  if (!value) return value;
  return value.length <= 4 ? value : `${'•'.repeat(Math.min(value.length - 4, 12))}${value.slice(-4)}`;
}

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
  ) {}

  private async bankDto(b: BankRow, reveal: boolean): Promise<BankAccountDto> {
    const createdBy = b.createdById
      ? await this.prisma.user.findUnique({ where: { id: b.createdById } })
      : null;
    return {
      id: b.id,
      bankName: b.bankName,
      accountName: b.accountName,
      accountNumber: reveal ? b.accountNumber : mask(b.accountNumber),
      iban: reveal ? b.iban : mask(b.iban),
      swift: b.swift,
      currency: b.currency,
      bankAddress: b.bankAddress,
      status: b.status,
      notes: b.notes,
      createdAt: tsReq(b.createdAt),
      createdBy: ref(createdBy),
      approvedBy: ref(b.approvedBy),
      approvedAt: ts(b.approvedAt),
    };
  }

  private async toDto(actor: Actor, s: SupplierRow): Promise<SupplierDto> {
    const loadingPort = s.defaultLoadingPortId
      ? await this.prisma.port.findUnique({ where: { id: s.defaultLoadingPortId } })
      : null;
    const reveal = can(actor, 'supplier_bank.manage') || can(actor, 'supplier_bank.approve');
    return {
      id: s.id,
      code: s.code,
      companyName: s.companyName,
      legalName: s.legalName,
      supplierType: s.supplierType,
      countryCode: s.countryCode,
      city: s.city,
      address: s.address,
      phone: s.phone,
      email: s.email,
      whatsapp: s.whatsapp,
      website: s.website,
      taxId: s.taxId,
      defaultCurrency: s.defaultCurrency,
      paymentTerm: ref(s.paymentTerm),
      productionLeadTimeDays: s.productionLeadTimeDays,
      defaultIncoterm: s.defaultIncoterm,
      defaultLoadingPort: ref(loadingPort),
      status: s.status,
      notes: s.notes,
      contacts: s.contacts.map(contactDto),
      addresses: s.addresses.map(addressDto),
      bankAccounts: can(actor, 'supplier_bank.view')
        ? await Promise.all(s.bankAccounts.map((b) => this.bankDto(b, reveal)))
        : null,
      createdAt: tsReq(s.createdAt),
      updatedAt: tsReq(s.updatedAt),
      version: s.version,
    };
  }

  async list(
    actor: Actor,
    q: SupplierFilter,
  ): Promise<{ page: Page<SupplierListItemDto>; rows: SupplierListItemDto[] }> {
    const where: Prisma.SupplierWhereInput = {
      companyId: actor.companyId,
      ...(q.status ? { status: q.status as Prisma.EnumSupplierStatusFilter['equals'] } : {}),
      ...(q.supplierType ? { supplierType: q.supplierType as Prisma.EnumSupplierTypeFilter['equals'] } : {}),
      ...(q.countryCode ? { countryCode: q.countryCode.toUpperCase() } : {}),
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
      this.prisma.supplier.findMany({
        where,
        include: { paymentTerm: true },
        orderBy: orderBy(
          q.sort,
          {
            code: (dir) => ({ code: dir }),
            companyName: (dir) => ({ companyName: dir }),
            countryCode: (dir) => ({ countryCode: dir }),
            supplierType: (dir) => ({ supplierType: dir }),
            status: (dir) => ({ status: dir }),
          },
          { companyName: 'asc' },
        ) as Prisma.SupplierOrderByWithRelationInput[],
        ...paging(q),
      }),
      this.prisma.supplier.count({ where }),
    ]);
    const items: SupplierListItemDto[] = rows.map((s) => ({
      id: s.id,
      code: s.code,
      companyName: s.companyName,
      supplierType: s.supplierType,
      countryCode: s.countryCode,
      city: s.city,
      status: s.status,
      defaultCurrency: s.defaultCurrency,
      paymentTerm: s.paymentTerm?.name ?? null,
      paymentTermId: s.paymentTermId,
      defaultIncoterm: s.defaultIncoterm,
      defaultLoadingPortId: s.defaultLoadingPortId,
      productionLeadTimeDays: s.productionLeadTimeDays,
      phone: s.phone,
      email: s.email,
    }));
    return { page: page(items, total, q), rows: items };
  }

  private async find(actor: Actor, id: string): Promise<SupplierRow> {
    const s = await this.prisma.supplier.findFirst({
      where: { id, companyId: actor.companyId },
      include: detailInclude,
    });
    if (!s) throw new NotFoundError('Supplier', id);
    return s;
  }

  async get(actor: Actor, id: string): Promise<SupplierDto> {
    return this.toDto(actor, await this.find(actor, id));
  }

  async create(actor: Actor, input: CreateSupplierInput): Promise<SupplierDto> {
    const created = await this.prisma.tx(async (tx) => {
      const code = await this.sequences.next(tx, actor.companyId, 'SUPP', 0);
      const { contacts, addresses, ...fields } = input;
      const s = await tx.supplier.create({
        data: {
          ...fields,
          companyId: actor.companyId,
          code,
          createdById: actor.userId,
          updatedById: actor.userId,
          contacts: { create: normalizePrimary(contacts) },
          addresses: { create: normalizeDefaults(addresses) },
        },
        include: detailInclude,
      });
      await this.audit.log(tx, actor, { entityType: 'supplier', entityId: s.id, action: 'create', after: s });
      await this.audit.activity(tx, actor, {
        eventType: 'supplier.created',
        entityType: 'supplier',
        entityId: s.id,
        supplierId: s.id,
        summary: `Supplier ${s.code} ${s.companyName} created`,
      });
      await this.audit.outbox(tx, 'supplier.created', 'supplier', s.id, {
        code: s.code,
        companyName: s.companyName,
      });
      return s;
    });
    return this.toDto(actor, created);
  }

  async update(actor: Actor, id: string, input: UpdateSupplierInput): Promise<SupplierDto> {
    const current = await this.find(actor, id);
    assertVersion('Supplier', current.version, input.version);
    if (
      input.status &&
      input.status !== current.status &&
      (input.status === 'INACTIVE' || current.status === 'INACTIVE')
    ) {
      if (!can(actor, 'supplier.archive')) throw new ForbiddenError('You cannot archive suppliers');
    }
    const { version: _v, ...fields } = input;
    const updated = await this.prisma.tx(async (tx) => {
      const s = await tx.supplier.update({
        where: { id },
        data: { ...fields, updatedById: actor.userId, version: { increment: 1 } },
        include: detailInclude,
      });
      await this.audit.log(tx, actor, {
        entityType: 'supplier',
        entityId: id,
        action: 'update',
        before: current,
        after: s,
      });
      return s;
    });
    return this.toDto(actor, updated);
  }

  // ───────────── Contacts & addresses ─────────────

  async addContact(actor: Actor, supplierId: string, input: ContactInput): Promise<SupplierDto> {
    await this.find(actor, supplierId);
    await this.prisma.tx(async (tx) => {
      if (input.isPrimary)
        await tx.supplierContact.updateMany({ where: { supplierId }, data: { isPrimary: false } });
      const c = await tx.supplierContact.create({ data: { ...input, supplierId } });
      await this.audit.log(tx, actor, {
        entityType: 'supplier',
        entityId: supplierId,
        action: 'contact_added',
        after: c,
      });
    });
    return this.get(actor, supplierId);
  }

  async updateContact(
    actor: Actor,
    supplierId: string,
    contactId: string,
    input: ContactInput,
  ): Promise<SupplierDto> {
    await this.find(actor, supplierId);
    await this.prisma.tx(async (tx) => {
      const before = await tx.supplierContact.findFirst({ where: { id: contactId, supplierId } });
      if (!before) throw new NotFoundError('Contact', contactId);
      if (input.isPrimary)
        await tx.supplierContact.updateMany({ where: { supplierId }, data: { isPrimary: false } });
      const after = await tx.supplierContact.update({ where: { id: contactId }, data: input });
      await this.audit.log(tx, actor, {
        entityType: 'supplier',
        entityId: supplierId,
        action: 'contact_updated',
        before,
        after,
      });
    });
    return this.get(actor, supplierId);
  }

  async deleteContact(actor: Actor, supplierId: string, contactId: string): Promise<SupplierDto> {
    await this.find(actor, supplierId);
    await this.prisma.tx(async (tx) => {
      const before = await tx.supplierContact.findFirst({ where: { id: contactId, supplierId } });
      if (!before) throw new NotFoundError('Contact', contactId);
      await tx.supplierContact.delete({ where: { id: contactId } });
      await this.audit.log(tx, actor, {
        entityType: 'supplier',
        entityId: supplierId,
        action: 'contact_removed',
        before,
        after: null,
      });
    });
    return this.get(actor, supplierId);
  }

  async addAddress(actor: Actor, supplierId: string, input: AddressInput): Promise<SupplierDto> {
    await this.find(actor, supplierId);
    await this.prisma.tx(async (tx) => {
      if (input.isDefault)
        await tx.supplierAddress.updateMany({
          where: { supplierId, type: input.type },
          data: { isDefault: false },
        });
      const a = await tx.supplierAddress.create({ data: { ...input, supplierId } });
      await this.audit.log(tx, actor, {
        entityType: 'supplier',
        entityId: supplierId,
        action: 'address_added',
        after: a,
      });
    });
    return this.get(actor, supplierId);
  }

  async deleteAddress(actor: Actor, supplierId: string, addressId: string): Promise<SupplierDto> {
    await this.find(actor, supplierId);
    await this.prisma.tx(async (tx) => {
      const before = await tx.supplierAddress.findFirst({ where: { id: addressId, supplierId } });
      if (!before) throw new NotFoundError('Address', addressId);
      await tx.supplierAddress.delete({ where: { id: addressId } });
      await this.audit.log(tx, actor, {
        entityType: 'supplier',
        entityId: supplierId,
        action: 'address_removed',
        before,
        after: null,
      });
    });
    return this.get(actor, supplierId);
  }

  // ───────────── Bank accounts (four-eyes) ─────────────

  /** New or changed beneficiary details always start as PENDING_APPROVAL. */
  async addBankAccount(actor: Actor, supplierId: string, input: BankAccountInput): Promise<SupplierDto> {
    const supplier = await this.find(actor, supplierId);
    await this.prisma.tx(async (tx) => {
      const b = await tx.supplierBankAccount.create({
        data: { ...input, supplierId, status: 'PENDING_APPROVAL', createdById: actor.userId },
      });
      await this.audit.log(tx, actor, {
        entityType: 'supplier_bank_account',
        entityId: b.id,
        action: 'create',
        after: { ...b, supplier: supplier.code },
      });
      await this.audit.activity(tx, actor, {
        eventType: 'supplier.bank_account_added',
        entityType: 'supplier',
        entityId: supplierId,
        supplierId,
        summary: `Bank account at ${b.bankName} (${b.currency}) added — awaiting approval`,
      });
    });
    return this.get(actor, supplierId);
  }

  async approveBankAccount(actor: Actor, supplierId: string, accountId: string): Promise<SupplierDto> {
    await this.find(actor, supplierId);
    await this.prisma.tx(async (tx) => {
      const b = await tx.supplierBankAccount.findFirst({ where: { id: accountId, supplierId } });
      if (!b) throw new NotFoundError('Bank account', accountId);
      if (b.status !== 'PENDING_APPROVAL')
        throw new BusinessRuleError(`Bank account is ${b.status}, not pending approval`);
      if (b.createdById === actor.userId) {
        throw new BusinessRuleError(
          'A different user must approve bank details you entered (four-eyes rule)',
          'FOUR_EYES',
        );
      }
      await tx.supplierBankAccount.update({
        where: { id: accountId },
        data: { status: 'APPROVED', approvedById: actor.userId, approvedAt: new Date() },
      });
      await this.audit.log(tx, actor, {
        entityType: 'supplier_bank_account',
        entityId: accountId,
        action: 'approve',
        before: { status: b.status },
        after: { status: 'APPROVED' },
      });
      await this.audit.activity(tx, actor, {
        eventType: 'supplier.bank_account_approved',
        entityType: 'supplier',
        entityId: supplierId,
        supplierId,
        summary: `Bank account at ${b.bankName} (${b.currency}) approved`,
      });
    });
    return this.get(actor, supplierId);
  }

  async revokeBankAccount(
    actor: Actor,
    supplierId: string,
    accountId: string,
    reason: string,
  ): Promise<SupplierDto> {
    await this.find(actor, supplierId);
    await this.prisma.tx(async (tx) => {
      const b = await tx.supplierBankAccount.findFirst({ where: { id: accountId, supplierId } });
      if (!b) throw new NotFoundError('Bank account', accountId);
      if (b.status === 'REVOKED') throw new BusinessRuleError('Bank account is already revoked');
      await tx.supplierBankAccount.update({
        where: { id: accountId },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      await this.audit.log(tx, actor, {
        entityType: 'supplier_bank_account',
        entityId: accountId,
        action: 'revoke',
        before: { status: b.status },
        after: { status: 'REVOKED' },
        reason,
      });
    });
    return this.get(actor, supplierId);
  }
}
