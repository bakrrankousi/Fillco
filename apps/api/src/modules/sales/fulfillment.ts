import { Prisma } from '@fillco/db';
import { SoLineQuantities } from '@fillco/domain';
import type { Tx } from '../../common/prisma.service';

export interface LineFulfillment extends SoLineQuantities {
  salesOrderId: string;
  salesOrderLineId: string;
}

interface Row {
  sales_order_id: string;
  sales_order_line_id: string;
  ordered_qty_kg: Prisma.Decimal;
  purchased_committed_kg: Prisma.Decimal;
  purchased_pending_kg: Prisma.Decimal;
  tolerance_pct: Prisma.Decimal;
  line_status: 'OPEN' | 'CLOSED_SHORT' | 'CANCELLED';
}

/** Per-line purchase progress from the v_so_line_fulfillment view, grouped by order. */
export async function loadFulfillment(tx: Tx, salesOrderIds: string[]): Promise<Map<string, LineFulfillment[]>> {
  const out = new Map<string, LineFulfillment[]>();
  if (salesOrderIds.length === 0) return out;
  const rows = await tx.$queryRaw<Row[]>`
    SELECT sales_order_id, sales_order_line_id, ordered_qty_kg, purchased_committed_kg, purchased_pending_kg,
           tolerance_pct, line_status::text AS line_status
    FROM v_so_line_fulfillment
    WHERE sales_order_id = ANY(${salesOrderIds}::uuid[])`;
  for (const r of rows) {
    const list = out.get(r.sales_order_id) ?? [];
    list.push({
      salesOrderId: r.sales_order_id,
      salesOrderLineId: r.sales_order_line_id,
      ordered: r.ordered_qty_kg.toFixed(),
      purchasedCommitted: r.purchased_committed_kg.toFixed(),
      purchasedPending: r.purchased_pending_kg.toFixed(),
      tolerancePct: r.tolerance_pct.toFixed(),
      lineStatus: r.line_status,
      // Shipping quantities arrive with the logistics module (Phase 2).
      shipped: '0',
      delivered: '0',
      invoiced: '0',
    });
    out.set(r.sales_order_id, list);
  }
  return out;
}
