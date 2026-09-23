import { Injectable } from '@nestjs/common';
import type {
  AttributeDefinitionDto,
  AttributeDefinitionInput,
  CategoryAttributeDto,
  CategoryAttributesInput,
  CategoryDto,
  CategoryInput,
  ListQuery,
  Page,
  ProductDto,
  ProductInput,
  ProductListItemDto,
  SpecValues,
  UpdateProductInput,
  VariantDto,
} from '@fillco/contracts';
import { Prisma } from '@fillco/db';
import {
  AttributeDefinition,
  canonicalSpec,
  CategoryAttributeRule,
  describeVariant,
  EnumOption,
  validateSpec,
} from '@fillco/domain';
import { createHash } from 'node:crypto';
import type { Actor } from '../../common/actor';
import { AuditService } from '../../common/audit.service';
import { assertVersion, BusinessRuleError, NotFoundError } from '../../common/errors';
import { contains, orderBy, page, paging } from '../../common/list';
import { PrismaService, Tx } from '../../common/prisma.service';
import { d, ref, tsReq } from '../../common/serialize';

type AttributeRow = Prisma.AttributeDefinitionGetPayload<object>;
type CategoryRow = Prisma.ProductCategoryGetPayload<{ include: { attributes: { include: { attribute: true } } } }>;

export interface EffectiveSpec {
  definitions: AttributeDefinition[];
  rules: CategoryAttributeRule[];
  dtos: CategoryAttributeDto[];
}

export function attributeDto(a: AttributeRow): AttributeDefinitionDto {
  return {
    id: a.id,
    code: a.code,
    label: a.label,
    dataType: a.dataType,
    unit: a.unit,
    enumOptions: (a.enumOptions as EnumOption[] | null) ?? null,
    trueLabel: a.trueLabel,
    falseLabel: a.falseLabel,
    minValue: d(a.minValue),
    maxValue: d(a.maxValue),
    description: a.description,
    isActive: a.isActive,
  };
}

function toDomainDefinition(a: AttributeRow): AttributeDefinition {
  return {
    code: a.code,
    label: a.label,
    dataType: a.dataType,
    unit: a.unit,
    enumOptions: (a.enumOptions as EnumOption[] | null) ?? null,
    trueLabel: a.trueLabel,
    falseLabel: a.falseLabel,
    minValue: a.minValue ? Number(a.minValue.toFixed()) : null,
    maxValue: a.maxValue ? Number(a.maxValue.toFixed()) : null,
  };
}

const productInclude = {
  category: true,
  fixedAttributes: { include: { attribute: true } },
  variants: { orderBy: { displayName: 'asc' } },
} satisfies Prisma.ProductInclude;
type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

export interface ProductFilter extends ListQuery {
  categoryId?: string;
  active?: string;
}

function variantDto(v: Prisma.ProductVariantGetPayload<object>): VariantDto {
  return {
    id: v.id,
    sku: v.sku,
    displayName: v.displayName,
    attributes: v.attributes as SpecValues,
    isActive: v.isActive,
    createdAt: tsReq(v.createdAt),
  };
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───────────── Categories & attributes ─────────────

  private async allCategories(tx: Tx = this.prisma): Promise<CategoryRow[]> {
    return tx.productCategory.findMany({
      include: { attributes: { include: { attribute: true } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  /** Rules of a category including inherited ones (a child's rule overrides its parent's). */
  private effective(categoryId: string, all: CategoryRow[]): EffectiveSpec {
    const byId = new Map(all.map((c) => [c.id, c]));
    const chain: CategoryRow[] = [];
    for (let c = byId.get(categoryId); c; c = c.parentId ? byId.get(c.parentId) : undefined) chain.unshift(c);
    const merged = new Map<string, { row: CategoryRow['attributes'][number]; from: CategoryRow }>();
    for (const cat of chain) for (const row of cat.attributes) merged.set(row.attribute.code, { row, from: cat });
    const entries = [...merged.values()].sort((a, b) => a.row.sortOrder - b.row.sortOrder);
    return {
      definitions: entries.map((e) => toDomainDefinition(e.row.attribute)),
      rules: entries.map((e) => ({
        code: e.row.attribute.code,
        required: e.row.isRequired,
        variantDefining: e.row.isVariantDefining,
        sortOrder: e.row.sortOrder,
      })),
      dtos: entries.map((e) => ({
        attribute: attributeDto(e.row.attribute),
        isRequired: e.row.isRequired,
        isVariantDefining: e.row.isVariantDefining,
        sortOrder: e.row.sortOrder,
        inheritedFrom: e.from.id === categoryId ? null : e.from.name,
      })),
    };
  }

  async effectiveSpec(categoryId: string, tx: Tx = this.prisma): Promise<EffectiveSpec> {
    return this.effective(categoryId, await this.allCategories(tx));
  }

  private path(categoryId: string, all: CategoryRow[]): string {
    const byId = new Map(all.map((c) => [c.id, c]));
    const names: string[] = [];
    for (let c = byId.get(categoryId); c; c = c.parentId ? byId.get(c.parentId) : undefined) names.unshift(c.name);
    return names.join(' › ');
  }

  async categories(): Promise<CategoryDto[]> {
    const all = await this.allCategories();
    const counts = await this.prisma.product.groupBy({ by: ['categoryId'], _count: { _all: true } });
    const countBy = new Map(counts.map((c) => [c.categoryId, c._count._all]));
    return all
      .map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        parentId: c.parentId,
        sortOrder: c.sortOrder,
        path: this.path(c.id, all),
        attributes: this.effective(c.id, all).dtos,
        productCount: countBy.get(c.id) ?? 0,
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async saveCategory(actor: Actor, input: CategoryInput, id?: string): Promise<CategoryDto[]> {
    await this.prisma.tx(async (tx) => {
      if (id && input.parentId) {
        // Prevent cycles: the new parent may not be the category itself or one of its descendants.
        const all = await this.allCategories(tx);
        const byId = new Map(all.map((c) => [c.id, c]));
        for (let c = byId.get(input.parentId); c; c = c.parentId ? byId.get(c.parentId) : undefined) {
          if (c.id === id) throw new BusinessRuleError('A category cannot be placed under itself');
        }
      }
      const before = id ? await tx.productCategory.findUnique({ where: { id } }) : null;
      if (id && !before) throw new NotFoundError('Category', id);
      const data = { code: input.code, name: input.name, parentId: input.parentId ?? null, sortOrder: input.sortOrder };
      const c = id ? await tx.productCategory.update({ where: { id }, data }) : await tx.productCategory.create({ data });
      await this.audit.log(tx, actor, { entityType: 'product_category', entityId: c.id, action: id ? 'update' : 'create', before, after: c });
    });
    return this.categories();
  }

  async setCategoryAttributes(actor: Actor, categoryId: string, input: CategoryAttributesInput): Promise<CategoryDto[]> {
    await this.prisma.tx(async (tx) => {
      const cat = await tx.productCategory.findUnique({ where: { id: categoryId }, include: { attributes: { include: { attribute: true } } } });
      if (!cat) throw new NotFoundError('Category', categoryId);
      await tx.categoryAttribute.deleteMany({ where: { categoryId } });
      await tx.categoryAttribute.createMany({ data: input.attributes.map((a) => ({ ...a, categoryId })) });
      const after = await tx.categoryAttribute.findMany({ where: { categoryId }, include: { attribute: true } });
      const describe = (rows: typeof after) =>
        rows.map((r) => `${r.attribute.code}${r.isRequired ? '*' : ''}${r.isVariantDefining ? '' : '(info)'}`).sort().join(', ');
      await this.audit.log(tx, actor, {
        entityType: 'product_category',
        entityId: categoryId,
        action: 'attributes_changed',
        before: { attributes: describe(cat.attributes) },
        after: { attributes: describe(after) },
      });
    });
    return this.categories();
  }

  async attributes(): Promise<AttributeDefinitionDto[]> {
    const rows = await this.prisma.attributeDefinition.findMany({ orderBy: { label: 'asc' } });
    return rows.map(attributeDto);
  }

  async saveAttribute(actor: Actor, input: AttributeDefinitionInput, id?: string): Promise<AttributeDefinitionDto> {
    return this.prisma.tx(async (tx) => {
      const before = id ? await tx.attributeDefinition.findUnique({ where: { id } }) : null;
      if (id && !before) throw new NotFoundError('Attribute', id);
      if (before && (before.dataType !== input.dataType || before.code !== input.code)) {
        const used = await tx.categoryAttribute.count({ where: { attributeId: before.id } });
        if (used > 0) throw new BusinessRuleError('Code and data type cannot change once the attribute is used by a category');
      }
      const data = {
        code: input.code,
        label: input.label,
        dataType: input.dataType,
        unit: input.unit ?? null,
        enumOptions: input.enumOptions ? (input.enumOptions as Prisma.InputJsonValue) : Prisma.JsonNull,
        trueLabel: input.trueLabel ?? null,
        falseLabel: input.falseLabel ?? null,
        minValue: input.minValue ?? null,
        maxValue: input.maxValue ?? null,
        description: input.description ?? null,
      };
      const a = id ? await tx.attributeDefinition.update({ where: { id }, data }) : await tx.attributeDefinition.create({ data });
      await this.audit.log(tx, actor, { entityType: 'attribute_definition', entityId: a.id, action: id ? 'update' : 'create', before, after: a });
      return attributeDto(a);
    });
  }

  // ───────────── Products ─────────────

  private fixedValues(p: Pick<ProductRow, 'fixedAttributes'>): SpecValues {
    return Object.fromEntries(p.fixedAttributes.map((f) => [f.attribute.code, f.value as string | number | boolean]));
  }

  private async productDto(p: ProductRow): Promise<ProductDto> {
    const all = await this.allCategories();
    const packaging = p.defaultPackagingTypeId
      ? await this.prisma.packagingType.findUnique({ where: { id: p.defaultPackagingTypeId } })
      : null;
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      category: ref(p.category)!,
      categoryPath: this.path(p.categoryId, all),
      description: p.description,
      baseUom: p.baseUom,
      defaultSalesUom: p.defaultSalesUom,
      defaultPurchaseUom: p.defaultPurchaseUom,
      hsCode: p.hsCode,
      countryOfOrigin: p.countryOfOrigin,
      defaultPurchaseCurrency: p.defaultPurchaseCurrency,
      defaultSalesCurrency: p.defaultSalesCurrency,
      defaultPackagingType: ref(packaging),
      isActive: p.isActive,
      notes: p.notes,
      fixedAttributes: this.fixedValues(p),
      specification: this.effective(p.categoryId, all).dtos,
      variants: p.variants.map(variantDto),
      version: p.version,
    };
  }

  async listProducts(q: ProductFilter): Promise<{ page: Page<ProductListItemDto>; rows: ProductListItemDto[] }> {
    const all = await this.allCategories();
    let categoryIds: string[] | undefined;
    if (q.categoryId) {
      // Include sub-categories.
      categoryIds = [q.categoryId];
      for (let grew = true; grew; ) {
        const next = all.filter((c) => c.parentId && categoryIds!.includes(c.parentId) && !categoryIds!.includes(c.id)).map((c) => c.id);
        grew = next.length > 0;
        categoryIds.push(...next);
      }
    }
    const where: Prisma.ProductWhereInput = {
      ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
      ...(q.active === 'true' ? { isActive: true } : q.active === 'false' ? { isActive: false } : {}),
      ...(q.q
        ? {
            OR: [
              { name: contains(q.q) },
              { code: contains(q.q) },
              { hsCode: contains(q.q) },
              { variants: { some: { OR: [{ displayName: contains(q.q) }, { sku: contains(q.q) }] } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: { category: true, _count: { select: { variants: true } } },
        orderBy: orderBy(
          q.sort,
          { code: (dir) => ({ code: dir }), name: (dir) => ({ name: dir }), createdAt: (dir) => ({ createdAt: dir }) },
          { name: 'asc' },
        ) as Prisma.ProductOrderByWithRelationInput[],
        ...paging(q),
      }),
      this.prisma.product.count({ where }),
    ]);
    const items: ProductListItemDto[] = rows.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      category: ref(p.category)!,
      categoryPath: this.path(p.categoryId, all),
      defaultSalesUom: p.defaultSalesUom,
      hsCode: p.hsCode,
      countryOfOrigin: p.countryOfOrigin,
      isActive: p.isActive,
      variantCount: p._count.variants,
    }));
    return { page: page(items, total, q), rows: items };
  }

  async getProduct(id: string): Promise<ProductDto> {
    const p = await this.prisma.product.findUnique({ where: { id }, include: productInclude });
    if (!p) throw new NotFoundError('Product', id);
    return this.productDto(p);
  }

  /** Validates fixed attribute values against the category's rules. */
  private async validateFixed(tx: Tx, categoryId: string, input: Record<string, unknown>) {
    const spec = await this.effectiveSpec(categoryId, tx);
    const cleaned = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== null && v !== undefined && v !== ''));
    const keys = Object.keys(cleaned);
    const result = validateSpec(
      spec.definitions,
      spec.rules.filter((r) => keys.includes(r.code)).map((r) => ({ ...r, required: false })),
      cleaned,
    );
    for (const k of keys) if (!spec.rules.some((r) => r.code === k)) result.errors[k] = `"${k}" does not apply to this category`;
    if (Object.keys(result.errors).length) {
      throw new BusinessRuleError('Invalid fixed specification', 'VALIDATION', undefined, prefixErrors('fixedAttributes', result.errors));
    }
    const attrs = await tx.attributeDefinition.findMany({ where: { code: { in: keys } } });
    return attrs.map((a) => ({ attributeId: a.id, value: result.values[a.code] as Prisma.InputJsonValue }));
  }

  private async assertUoms(tx: Tx, codes: (string | undefined)[]): Promise<void> {
    for (const code of codes) {
      if (code && !(await tx.uom.findUnique({ where: { code } }))) throw new BusinessRuleError(`Unknown unit ${code}`);
    }
  }

  async createProduct(actor: Actor, input: ProductInput): Promise<ProductDto> {
    const p = await this.prisma.tx(async (tx) => {
      await this.assertUoms(tx, [input.defaultSalesUom, input.defaultPurchaseUom]);
      const fixed = await this.validateFixed(tx, input.categoryId, input.fixedAttributes);
      const { fixedAttributes: _f, ...fields } = input;
      const created = await tx.product.create({
        data: { ...fields, createdById: actor.userId, fixedAttributes: { create: fixed } },
        include: productInclude,
      });
      await this.audit.log(tx, actor, {
        entityType: 'product',
        entityId: created.id,
        action: 'create',
        after: { ...created, fixedAttributes: JSON.stringify(this.fixedValues(created)) },
      });
      return created;
    });
    return this.productDto(p);
  }

  async updateProduct(actor: Actor, id: string, input: UpdateProductInput): Promise<ProductDto> {
    const p = await this.prisma.tx(async (tx) => {
      const current = await tx.product.findUnique({ where: { id }, include: productInclude });
      if (!current) throw new NotFoundError('Product', id);
      assertVersion('Product', current.version, input.version);
      const specChanges =
        (input.categoryId && input.categoryId !== current.categoryId) ||
        (input.fixedAttributes && JSON.stringify(sortKeys(input.fixedAttributes)) !== JSON.stringify(sortKeys(this.fixedValues(current))));
      if (specChanges && current.variants.length > 0) {
        throw new BusinessRuleError(
          'Category and fixed specification cannot change once variants exist. Create a new product instead.',
          'PRODUCT_IN_USE',
        );
      }
      await this.assertUoms(tx, [input.defaultSalesUom, input.defaultPurchaseUom]);
      const { fixedAttributes, version: _v, ...fields } = input;
      if (fixedAttributes) {
        const fixed = await this.validateFixed(tx, input.categoryId ?? current.categoryId, fixedAttributes);
        await tx.productAttributeValue.deleteMany({ where: { productId: id } });
        await tx.productAttributeValue.createMany({ data: fixed.map((f) => ({ ...f, productId: id })) });
      }
      const updated = await tx.product.update({ where: { id }, data: { ...fields, version: { increment: 1 } }, include: productInclude });
      await this.audit.log(tx, actor, {
        entityType: 'product',
        entityId: id,
        action: 'update',
        before: { ...current, fixedAttributes: JSON.stringify(this.fixedValues(current)) },
        after: { ...updated, fixedAttributes: JSON.stringify(this.fixedValues(updated)) },
      });
      return updated;
    });
    return this.productDto(p);
  }

  /**
   * Finds or creates the variant for a product + specification. Validation errors are keyed
   * `attributes.<code>` so forms can show them next to the right field.
   */
  async resolveVariant(
    tx: Tx,
    productId: string,
    input: Record<string, unknown>,
    errorPrefix = 'attributes',
  ): Promise<{ variant: Prisma.ProductVariantGetPayload<object>; values: SpecValues; product: ProductRow }> {
    const product = await tx.product.findUnique({ where: { id: productId }, include: productInclude });
    if (!product) throw new NotFoundError('Product', productId);
    if (!product.isActive) throw new BusinessRuleError(`Product ${product.code} is inactive`);
    const spec = await this.effectiveSpec(product.categoryId, tx);
    const fixed = this.fixedValues(product);
    const cleaned = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== null && v !== undefined && v !== ''));
    const result = validateSpec(spec.definitions, spec.rules, cleaned, fixed);
    if (!result.ok) {
      throw new BusinessRuleError(
        `Specification incomplete for ${product.name}: ${Object.values(result.errors).join('; ')}`,
        'INVALID_SPEC',
        undefined,
        prefixErrors(errorPrefix, result.errors),
      );
    }
    const canonical = canonicalSpec(result.values, spec.rules);
    const specHash = createHash('sha256').update(canonical).digest('hex');
    const defining = JSON.parse(canonical) as SpecValues;
    const displayName = describeVariant(product.name, spec.definitions, spec.rules, result.values, Object.keys(fixed));
    await tx.productVariant.createMany({
      data: [
        {
          productId,
          sku: `${product.code}-${specHash.slice(0, 8).toUpperCase()}`,
          specHash,
          attributes: defining as Prisma.InputJsonValue,
          displayName,
        },
      ],
      skipDuplicates: true,
    });
    const variant = await tx.productVariant.findUniqueOrThrow({ where: { productId_specHash: { productId, specHash } } });
    return { variant, values: result.values, product };
  }

  async resolveVariantDto(productId: string, attributes: Record<string, unknown>): Promise<VariantDto> {
    const { variant } = await this.prisma.tx((tx) => this.resolveVariant(tx, productId, attributes));
    return variantDto(variant);
  }
}

export function prefixErrors(prefix: string, errors: Record<string, string>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(errors).map(([k, v]) => [`${prefix}.${k}`, [v]]));
}

function sortKeys(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.keys(o)
      .filter((k) => o[k] !== null && o[k] !== undefined && o[k] !== '')
      .sort()
      .map((k) => [k, o[k]]),
  );
}
