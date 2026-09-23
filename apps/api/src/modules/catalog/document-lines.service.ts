import { Injectable } from '@nestjs/common';
import type { DocumentLineDto, DocumentLineInput, SpecValues } from '@fillco/contracts';
import { Prisma } from '@fillco/db';
import { computeDocumentTotals, computeLineTotals, dec, Decimal, DocumentTotals, toBaseQty } from '@fillco/domain';
import { BusinessRuleError } from '../../common/errors';
import type { Tx } from '../../common/prisma.service';
import { ref } from '../../common/serialize';
import { CatalogService } from './catalog.service';

export interface PreparedLine {
  id?: string;
  lineNo: number;
  productId: string;
  variantId: string;
  description: string;
  specSnapshot: Prisma.InputJsonValue;
  packagingTypeId: string | null;
  qty: string;
  uom: string;
  qtyBase: string;
  unitPrice: string;
  discountPct: string;
  lineTotal: string;
  notes: string | null;
}

export interface PreparedDocument {
  lines: PreparedLine[];
  totals: DocumentTotals;
}

type LineRow = {
  id: string;
  lineNo: number;
  variantId: string;
  description: string;
  specSnapshot: Prisma.JsonValue;
  packagingTypeId: string | null;
  qty: Prisma.Decimal;
  uom: string;
  qtyBase: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  discountPct: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  notes: string | null;
  variant: { id: string; sku: string; productId: string; product: { code: string } };
};

/**
 * Shared by quotations, sales orders and purchase orders: resolves each line's product
 * specification into a variant, converts quantities to the base unit and computes totals
 * with the domain rules, so every document type calculates identically.
 */
@Injectable()
export class DocumentLinesService {
  constructor(private readonly catalog: CatalogService) {}

  async prepare(tx: Tx, currency: string, lines: DocumentLineInput[]): Promise<PreparedDocument> {
    const cur = await tx.currency.findUnique({ where: { code: currency } });
    if (!cur || !cur.isActive) throw new BusinessRuleError(`Currency ${currency} is not available`);
    const uoms = new Map((await tx.uom.findMany()).map((u) => [u.code, u]));
    const packagingIds = new Set((await tx.packagingType.findMany({ select: { id: true } })).map((p) => p.id));

    const prepared: PreparedLine[] = [];
    for (const [index, line] of lines.entries()) {
      const uom = uoms.get(line.uom);
      if (!uom) throw new BusinessRuleError(`Line ${index + 1}: unknown unit ${line.uom}`, 'VALIDATION', undefined, { [`lines.${index}.uom`]: ['Unknown unit'] });
      if (uom.dimension !== 'MASS') {
        throw new BusinessRuleError(`Line ${index + 1}: only weight units are supported for trading lines`);
      }
      if (line.packagingTypeId && !packagingIds.has(line.packagingTypeId)) {
        throw new BusinessRuleError(`Line ${index + 1}: unknown packaging type`);
      }
      const { variant, values } = await this.catalog.resolveVariant(tx, line.productId, line.attributes, `lines.${index}.attributes`);
      const totals = computeLineTotals({ qty: line.qty, unitPrice: line.unitPrice, discountPct: line.discountPct }, cur.minorUnits);
      prepared.push({
        id: line.id,
        lineNo: index + 1,
        productId: line.productId,
        variantId: variant.id,
        description: line.description?.trim() || variant.displayName,
        specSnapshot: values as Prisma.InputJsonValue,
        packagingTypeId: line.packagingTypeId ?? null,
        qty: dec(line.qty).toFixed(),
        uom: line.uom,
        qtyBase: toBaseQty(line.qty, uom.factorToBase.toFixed()).toFixed(),
        unitPrice: dec(line.unitPrice).toFixed(),
        discountPct: dec(line.discountPct).toFixed(),
        lineTotal: totals.net.toFixed(cur.minorUnits),
        notes: line.notes ?? null,
      });
    }
    const totals = computeDocumentTotals(
      lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct })),
      {},
      cur.minorUnits,
    );
    return { lines: prepared, totals };
  }

  /** Common DTO fields for a stored line. Prices are hidden when `showPrice` is false. */
  static toDto(line: LineRow, packaging: Map<string, { id: string; code: string; name: string }>, showPrice = true): DocumentLineDto {
    return {
      id: line.id,
      lineNo: line.lineNo,
      productId: line.variant.productId,
      productCode: line.variant.product.code,
      variantId: line.variantId,
      sku: line.variant.sku,
      description: line.description,
      attributes: line.specSnapshot as SpecValues,
      packagingType: line.packagingTypeId ? ref(packaging.get(line.packagingTypeId) ?? null) : null,
      qty: line.qty.toFixed(),
      uom: line.uom,
      qtyBase: line.qtyBase.toFixed(),
      unitPrice: showPrice ? line.unitPrice.toFixed() : null,
      discountPct: line.discountPct.toFixed(),
      lineTotal: showPrice ? line.lineTotal.toFixed() : null,
      notes: line.notes,
    };
  }

  static async packagingMap(tx: Tx): Promise<Map<string, { id: string; code: string; name: string }>> {
    return new Map((await tx.packagingType.findMany()).map((p) => [p.id, p]));
  }
}

/** Sum of line totals for lines that still count (cancelled lines drop out of the order value). */
export function activeTotal(lines: { lineTotal: Prisma.Decimal | string; lineStatus?: string }[]): Decimal {
  return lines
    .filter((l) => l.lineStatus !== 'CANCELLED')
    .reduce((acc, l) => acc.plus(dec(l.lineTotal.toString())), new Decimal(0));
}
