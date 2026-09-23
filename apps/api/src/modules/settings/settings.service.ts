import { Injectable } from '@nestjs/common';
import type {
  AuditLogDto,
  CompanyDto,
  CurrencyDto,
  CurrencyInput,
  ExchangeRateDto,
  ExchangeRateInput,
  LookupsDto,
  PaymentTermDto,
  PaymentTermInput,
  PortDto,
  PortInput,
  UpdateCompanyInput,
} from '@fillco/contracts';
import { Prisma } from '@fillco/db';
import { describeInstallments, isoToDate, validateInstallmentRules } from '@fillco/domain';
import type { Actor } from '../../common/actor';
import { AuditService } from '../../common/audit.service';
import { assertVersion, BusinessRuleError, NotFoundError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { d, dayReq, ref, tsReq } from '../../common/serialize';

const termInclude = { installments: { orderBy: { seq: 'asc' } } } satisfies Prisma.PaymentTermInclude;
type TermRow = Prisma.PaymentTermGetPayload<{ include: typeof termInclude }>;

export function termSummary(t: TermRow): string {
  return describeInstallments(
    t.installments.map((i) => ({
      percent: i.percent.toFixed(),
      triggerEvent: i.triggerEvent,
      offsetDays: i.offsetDays,
    })),
  );
}

function termDto(t: TermRow): PaymentTermDto {
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    description: t.description,
    isActive: t.isActive,
    summary: termSummary(t),
    installments: t.installments.map((i) => ({
      seq: i.seq,
      percent: i.percent.toFixed(),
      triggerEvent: i.triggerEvent,
      offsetDays: i.offsetDays,
      instrument: i.instrument,
    })),
    version: t.version,
  };
}

function rateDto(r: Prisma.ExchangeRateGetPayload<object>): ExchangeRateDto {
  return {
    id: r.id,
    rateDate: dayReq(r.rateDate),
    fromCurrency: r.fromCurrency,
    toCurrency: r.toCurrency,
    rate: r.rate.toFixed(),
    source: r.source,
    createdAt: tsReq(r.createdAt),
  };
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───────────── Company ─────────────

  private async baseCurrencyLocked(companyId: string): Promise<boolean> {
    const [so, po] = await Promise.all([
      this.prisma.salesOrder.count({ where: { companyId, confirmedAt: { not: null } } }),
      this.prisma.purchaseOrder.count({ where: { companyId, confirmedAt: { not: null } } }),
    ]);
    return so + po > 0;
  }

  async company(actor: Actor): Promise<CompanyDto> {
    const c = await this.prisma.company.findUniqueOrThrow({ where: { id: actor.companyId } });
    return {
      id: c.id,
      name: c.name,
      legalName: c.legalName,
      taxId: c.taxId,
      address: c.address,
      city: c.city,
      countryCode: c.countryCode,
      phone: c.phone,
      email: c.email,
      website: c.website,
      baseCurrency: c.baseCurrency,
      baseCurrencyEditable: !(await this.baseCurrencyLocked(c.id)),
      timezone: c.timezone,
      blockOverdueDays: c.blockOverdueDays,
      defaultTolerancePct: c.defaultTolerancePct.toFixed(),
      invoiceFooter: c.invoiceFooter,
      version: c.version,
    };
  }

  async updateCompany(actor: Actor, input: UpdateCompanyInput): Promise<CompanyDto> {
    const current = await this.prisma.company.findUniqueOrThrow({ where: { id: actor.companyId } });
    assertVersion('Company settings', current.version, input.version);
    if (input.baseCurrency && input.baseCurrency !== current.baseCurrency) {
      if (await this.baseCurrencyLocked(current.id)) {
        throw new BusinessRuleError(
          'The base currency cannot change after orders have been confirmed: historical base amounts would become meaningless.',
          'BASE_CURRENCY_LOCKED',
        );
      }
    }
    if (input.timezone) {
      try {
        new Intl.DateTimeFormat('en', { timeZone: input.timezone });
      } catch {
        throw new BusinessRuleError('Unknown timezone', 'VALIDATION', undefined, {
          timezone: ['Unknown timezone'],
        });
      }
    }
    const { version: _v, ...data } = input;
    await this.prisma.tx(async (tx) => {
      const updated = await tx.company.update({
        where: { id: current.id },
        data: { ...data, version: { increment: 1 } },
      });
      await this.audit.log(tx, actor, {
        entityType: 'company',
        entityId: current.id,
        action: 'update',
        before: current,
        after: updated,
      });
    });
    return this.company(actor);
  }

  // ───────────── Lookups ─────────────

  async lookups(actor: Actor): Promise<LookupsDto> {
    const [company, currencies, countries, ports, incoterms, uoms, packaging, terms, users] =
      await Promise.all([
        this.prisma.company.findUniqueOrThrow({ where: { id: actor.companyId } }),
        this.prisma.currency.findMany({ orderBy: { code: 'asc' } }),
        this.prisma.country.findMany({ orderBy: { name: 'asc' } }),
        this.prisma.port.findMany({ orderBy: [{ countryCode: 'asc' }, { name: 'asc' }] }),
        this.prisma.incoterm.findMany(),
        this.prisma.uom.findMany({ orderBy: { factorToBase: 'desc' } }),
        this.prisma.packagingType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
        this.prisma.paymentTerm.findMany({ include: termInclude, orderBy: { name: 'asc' } }),
        this.prisma.user.findMany({
          where: { companyId: actor.companyId, isActive: true },
          orderBy: { fullName: 'asc' },
        }),
      ]);
    const incotermOrder = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];
    return {
      baseCurrency: company.baseCurrency,
      currencies: currencies.map((c) => ({
        code: c.code,
        name: c.name,
        symbol: c.symbol,
        minorUnits: c.minorUnits,
        isActive: c.isActive,
      })),
      countries: countries.map((c) => ({ code: c.code, name: c.name, region: c.region })),
      ports: ports.map((p) => ({
        id: p.id,
        locode: p.locode,
        name: p.name,
        countryCode: p.countryCode,
        type: p.type,
        isActive: p.isActive,
      })),
      incoterms: incoterms
        .sort((a, b) => incotermOrder.indexOf(a.code) - incotermOrder.indexOf(b.code))
        .map((i) => ({
          code: i.code,
          name: i.name,
          description: i.description,
          sellerPaysMainCarriage: i.sellerPaysMainCarriage,
          sellerPaysInsurance: i.sellerPaysInsurance,
        })),
      uoms: uoms.map((u) => ({
        code: u.code,
        name: u.name,
        dimension: u.dimension,
        factorToBase: u.factorToBase.toFixed(),
      })),
      packagingTypes: packaging.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        nominalWeightKg: d(p.nominalWeightKg),
      })),
      paymentTerms: terms.map((t) => ({
        id: t.id,
        code: t.code,
        name: t.name,
        summary: termSummary(t),
        isActive: t.isActive,
      })),
      users: users.map((u) => ref(u)!),
    };
  }

  // ───────────── Currencies & rates ─────────────

  async currencies(): Promise<CurrencyDto[]> {
    const rows = await this.prisma.currency.findMany({ orderBy: { code: 'asc' } });
    return rows.map((c) => ({
      code: c.code,
      name: c.name,
      symbol: c.symbol,
      minorUnits: c.minorUnits,
      isActive: c.isActive,
    }));
  }

  async upsertCurrency(actor: Actor, input: CurrencyInput): Promise<CurrencyDto> {
    return this.prisma.tx(async (tx) => {
      const before = await tx.currency.findUnique({ where: { code: input.code } });
      if (before && before.minorUnits !== input.minorUnits) {
        throw new BusinessRuleError('Minor units of an existing currency cannot change');
      }
      const c = await tx.currency.upsert({ where: { code: input.code }, create: input, update: input });
      await this.audit.log(tx, actor, {
        entityType: 'currency',
        entityId: c.code,
        action: before ? 'update' : 'create',
        before,
        after: c,
      });
      return { code: c.code, name: c.name, symbol: c.symbol, minorUnits: c.minorUnits, isActive: c.isActive };
    });
  }

  async exchangeRates(filter: { currency?: string; from?: string; to?: string }): Promise<ExchangeRateDto[]> {
    const rows = await this.prisma.exchangeRate.findMany({
      where: {
        ...(filter.currency
          ? { OR: [{ fromCurrency: filter.currency }, { toCurrency: filter.currency }] }
          : {}),
        rateDate: {
          ...(filter.from ? { gte: isoToDate(filter.from) } : {}),
          ...(filter.to ? { lte: isoToDate(filter.to) } : {}),
        },
      },
      orderBy: [{ rateDate: 'desc' }, { fromCurrency: 'asc' }],
      take: 500,
    });
    return rows.map(rateDto);
  }

  /** One manual rate per day and pair; re-entering corrects it (audited). Documents keep the rate they stored. */
  async saveExchangeRate(actor: Actor, input: ExchangeRateInput): Promise<ExchangeRateDto> {
    return this.prisma.tx(async (tx) => {
      const key = {
        rateDate_fromCurrency_toCurrency_source: {
          rateDate: isoToDate(input.rateDate),
          fromCurrency: input.fromCurrency,
          toCurrency: input.toCurrency,
          source: 'MANUAL',
        },
      };
      const before = await tx.exchangeRate.findUnique({ where: key });
      const row = await tx.exchangeRate.upsert({
        where: key,
        create: {
          rateDate: isoToDate(input.rateDate),
          fromCurrency: input.fromCurrency,
          toCurrency: input.toCurrency,
          rate: input.rate,
          source: 'MANUAL',
          createdById: actor.userId,
        },
        update: { rate: input.rate, createdById: actor.userId },
      });
      await this.audit.log(tx, actor, {
        entityType: 'exchange_rate',
        entityId: row.id,
        action: before ? 'update' : 'create',
        before: before ? { rate: before.rate } : null,
        after: {
          rateDate: input.rateDate,
          pair: `${input.fromCurrency}/${input.toCurrency}`,
          rate: row.rate,
        },
      });
      return rateDto(row);
    });
  }

  // ───────────── Ports ─────────────

  async ports(): Promise<PortDto[]> {
    const rows = await this.prisma.port.findMany({ orderBy: [{ countryCode: 'asc' }, { name: 'asc' }] });
    return rows.map((p) => ({
      id: p.id,
      locode: p.locode,
      name: p.name,
      countryCode: p.countryCode,
      type: p.type,
      isActive: p.isActive,
    }));
  }

  async savePort(actor: Actor, input: PortInput, id?: string): Promise<PortDto> {
    return this.prisma.tx(async (tx) => {
      const before = id ? await tx.port.findUnique({ where: { id } }) : null;
      if (id && !before) throw new NotFoundError('Port', id);
      const p = id
        ? await tx.port.update({ where: { id }, data: input })
        : await tx.port.create({ data: input });
      await this.audit.log(tx, actor, {
        entityType: 'port',
        entityId: p.id,
        action: id ? 'update' : 'create',
        before,
        after: p,
      });
      return {
        id: p.id,
        locode: p.locode,
        name: p.name,
        countryCode: p.countryCode,
        type: p.type,
        isActive: p.isActive,
      };
    });
  }

  // ───────────── Payment terms ─────────────

  async paymentTerms(): Promise<PaymentTermDto[]> {
    const rows = await this.prisma.paymentTerm.findMany({ include: termInclude, orderBy: { name: 'asc' } });
    return rows.map(termDto);
  }

  /**
   * Replaces a term's installments. Safe for existing orders: confirmed documents keep the schedule
   * snapshot they took at confirmation.
   */
  async savePaymentTerm(
    actor: Actor,
    input: PaymentTermInput,
    id?: string,
    version?: number,
  ): Promise<PaymentTermDto> {
    validateInstallmentRules(input.installments);
    return this.prisma.tx(async (tx) => {
      const before = id ? await tx.paymentTerm.findUnique({ where: { id }, include: termInclude }) : null;
      if (id && !before) throw new NotFoundError('Payment term', id);
      if (before && version !== undefined) assertVersion('Payment term', before.version, version);
      const installments = input.installments.map((i, idx) => ({
        seq: idx + 1,
        percent: i.percent,
        triggerEvent: i.triggerEvent,
        offsetDays: i.offsetDays,
        instrument: i.instrument ?? null,
      }));
      const data = {
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        isActive: input.isActive,
      };
      let term: TermRow;
      if (id) {
        await tx.paymentTermInstallment.deleteMany({ where: { paymentTermId: id } });
        term = await tx.paymentTerm.update({
          where: { id },
          data: { ...data, version: { increment: 1 }, installments: { create: installments } },
          include: termInclude,
        });
      } else {
        term = await tx.paymentTerm.create({
          data: { ...data, installments: { create: installments } },
          include: termInclude,
        });
      }
      await this.audit.log(tx, actor, {
        entityType: 'payment_term',
        entityId: term.id,
        action: id ? 'update' : 'create',
        before: before ? { ...before, installments: before ? termSummary(before) : null } : null,
        after: { ...term, installments: termSummary(term) },
      });
      return termDto(term);
    });
  }

  // ───────────── Audit ─────────────

  async auditLogs(filter: {
    entityType?: string;
    entityId?: string;
    userId?: string;
    take?: number;
  }): Promise<AuditLogDto[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: { entityType: filter.entityType, entityId: filter.entityId, userId: filter.userId },
      include: { user: true },
      orderBy: { occurredAt: 'desc' },
      take: Math.min(filter.take ?? 200, 1000),
    });
    return rows.map((r) => ({
      id: r.id.toString(),
      occurredAt: tsReq(r.occurredAt),
      user: ref(r.user),
      entityType: r.entityType,
      entityId: r.entityId,
      action: r.action,
      changes: r.changes,
      reason: r.reason,
    }));
  }
}
