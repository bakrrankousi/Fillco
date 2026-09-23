import { hash } from '@node-rs/argon2';
import { Prisma, PrismaClient } from '@prisma/client';
import { validateInstallmentRules } from '@fillco/domain';
import {
  ATTRIBUTES,
  CATEGORIES,
  COUNTRIES,
  CURRENCIES,
  INCOTERMS,
  PACKAGING_TYPES,
  PAYMENT_TERMS,
  PORTS,
  UOMS,
} from './reference-data';

/** Role definitions are passed in (they live in @fillco/contracts) to keep this package independent. */
export interface BootstrapRole {
  code: string;
  name: string;
  description: string;
  permissions: readonly string[];
}

export interface BootstrapOptions {
  roles: readonly BootstrapRole[];
  companyName?: string;
  baseCurrency?: string;
  timezone?: string;
  admin?: { email: string; password: string; fullName?: string };
}

/** Argon2id parameters (OWASP recommended minimums). */
export const PASSWORD_HASH_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, PASSWORD_HASH_OPTIONS);
}

/**
 * Idempotently loads reference data, system roles, the company and the first admin user.
 * Safe to run on every deployment: existing rows are updated, never duplicated or deleted.
 */
export async function bootstrap(prisma: PrismaClient, options: BootstrapOptions): Promise<{ companyId: string }> {
  for (const c of CURRENCIES) {
    await prisma.currency.upsert({
      where: { code: c.code },
      create: { ...c },
      update: { name: c.name, symbol: c.symbol, minorUnits: c.minorUnits },
    });
  }
  for (const c of COUNTRIES) {
    await prisma.country.upsert({ where: { code: c.code }, create: c, update: { name: c.name, region: c.region } });
  }
  for (const p of PORTS) {
    await prisma.port.upsert({ where: { locode: p.locode }, create: p, update: { name: p.name } });
  }
  for (const i of INCOTERMS) {
    const data = {
      name: i.name,
      sellerPaysMainCarriage: i.main,
      sellerPaysInsurance: i.ins,
      seaOnly: i.sea,
    };
    await prisma.incoterm.upsert({ where: { code: i.code }, create: { code: i.code, ...data }, update: data });
  }
  for (const u of UOMS) {
    await prisma.uom.upsert({ where: { code: u.code }, create: { ...u }, update: { name: u.name } });
  }
  for (const p of PACKAGING_TYPES) {
    await prisma.packagingType.upsert({ where: { code: p.code }, create: { ...p }, update: { name: p.name } });
  }
  for (const t of PAYMENT_TERMS) {
    validateInstallmentRules(t.installments);
    const existing = await prisma.paymentTerm.findUnique({ where: { code: t.code } });
    if (!existing) {
      await prisma.paymentTerm.create({
        data: {
          code: t.code,
          name: t.name,
          installments: {
            create: t.installments.map((i, idx) => ({
              seq: idx + 1,
              percent: i.percent,
              triggerEvent: i.triggerEvent,
              offsetDays: i.offsetDays,
              instrument: i.instrument ?? null,
            })),
          },
        },
      });
    }
  }

  // Specification attributes and category tree
  const attributeIds = new Map<string, string>();
  for (const a of ATTRIBUTES) {
    const data = {
      label: a.label,
      dataType: a.dataType,
      unit: 'unit' in a ? a.unit : null,
      enumOptions: 'enumOptions' in a ? (a.enumOptions as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      trueLabel: 'trueLabel' in a ? a.trueLabel : null,
      falseLabel: 'falseLabel' in a ? a.falseLabel : null,
      minValue: 'minValue' in a ? a.minValue : null,
      maxValue: 'maxValue' in a ? a.maxValue : null,
    };
    const row = await prisma.attributeDefinition.upsert({
      where: { code: a.code },
      create: { code: a.code, ...data },
      update: {},
    });
    attributeIds.set(a.code, row.id);
  }
  const categoryIds = new Map<string, string>();
  const depth = (code: string): number => {
    const c = CATEGORIES.find((x) => x.code === code);
    return c?.parent ? 1 + depth(c.parent) : 0;
  };
  for (const c of CATEGORIES) {
    const parentId = c.parent ? categoryIds.get(c.parent) : undefined;
    const row = await prisma.productCategory.upsert({
      where: { code: c.code },
      create: { code: c.code, name: c.name, sortOrder: c.sortOrder, parentId },
      update: {},
    });
    categoryIds.set(c.code, row.id);
    for (const [index, rule] of c.rules.entries()) {
      const attributeId = attributeIds.get(rule.code);
      if (!attributeId) throw new Error(`Unknown attribute ${rule.code} in category ${c.code}`);
      await prisma.categoryAttribute.upsert({
        where: { categoryId_attributeId: { categoryId: row.id, attributeId } },
        create: {
          categoryId: row.id,
          attributeId,
          isRequired: rule.required ?? false,
          isVariantDefining: rule.variantDefining ?? true,
          sortOrder: depth(c.code) * 100 + (index + 1) * 10,
        },
        update: {},
      });
    }
  }

  // Roles: system role permissions are re-synced so new permissions reach existing installs.
  for (const r of options.roles) {
    const role = await prisma.role.upsert({
      where: { code: r.code },
      create: { code: r.code, name: r.name, description: r.description, isSystem: true },
      update: { name: r.name, description: r.description, isSystem: true },
    });
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: role.id, permission: { notIn: [...r.permissions] } } }),
      prisma.rolePermission.createMany({
        data: r.permissions.map((permission) => ({ roleId: role.id, permission })),
        skipDuplicates: true,
      }),
    ]);
  }

  let company = await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!company) {
    company = await prisma.company.create({
      data: {
        name: options.companyName ?? 'Fillco Trading',
        baseCurrency: options.baseCurrency ?? 'USD',
        timezone: options.timezone ?? 'Europe/Istanbul',
      },
    });
  }

  if (options.admin) {
    const email = options.admin.email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (!existing) {
      const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
      await prisma.user.create({
        data: {
          companyId: company.id,
          email,
          fullName: options.admin.fullName ?? 'Administrator',
          passwordHash: await hashPassword(options.admin.password),
          roles: { create: [{ roleId: adminRole.id }] },
        },
      });
    }
  }

  return { companyId: company.id };
}
