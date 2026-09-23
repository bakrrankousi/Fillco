import { PrismaClient } from '@prisma/client';

export interface IntegrityCheckResult {
  name: string;
  description: string;
  violations: number;
  sample: unknown[];
}

interface Check {
  name: string;
  description: string;
  /** Returns offending rows; an empty result means the check passed. */
  sql: string;
}

/**
 * Database-wide consistency checks run after each phase (and in CI against demo data).
 * They verify derived values stored for performance still equal their source of truth.
 */
export const INTEGRITY_CHECKS: Check[] = [
  {
    name: 'line_qty_base',
    description: 'qty_base = qty × unit factor on all document lines',
    sql: `
      SELECT 'sales_order_lines' AS tbl, l.id FROM sales_order_lines l JOIN uoms u ON u.code = l.uom
        WHERE round(l.qty * u.factor_to_base, 4) <> l.qty_base
      UNION ALL
      SELECT 'purchase_order_lines', l.id FROM purchase_order_lines l JOIN uoms u ON u.code = l.uom
        WHERE round(l.qty * u.factor_to_base, 4) <> l.qty_base
      UNION ALL
      SELECT 'quotation_lines', l.id FROM quotation_lines l JOIN uoms u ON u.code = l.uom
        WHERE round(l.qty * u.factor_to_base, 4) <> l.qty_base`,
  },
  {
    name: 'line_totals',
    description: 'line_total = round(qty × price × (1 − discount%), currency minor units)',
    sql: `
      SELECT 'sales_order_lines' AS tbl, l.id FROM sales_order_lines l
        JOIN sales_orders d ON d.id = l.sales_order_id JOIN currencies c ON c.code = d.currency
        WHERE round(l.qty * l.unit_price * (100 - l.discount_pct) / 100, c.minor_units) <> l.line_total
      UNION ALL
      SELECT 'purchase_order_lines', l.id FROM purchase_order_lines l
        JOIN purchase_orders d ON d.id = l.purchase_order_id JOIN currencies c ON c.code = d.currency
        WHERE round(l.qty * l.unit_price * (100 - l.discount_pct) / 100, c.minor_units) <> l.line_total
      UNION ALL
      SELECT 'quotation_lines', l.id FROM quotation_lines l
        JOIN quotations d ON d.id = l.quotation_id JOIN currencies c ON c.code = d.currency
        WHERE round(l.qty * l.unit_price * (100 - l.discount_pct) / 100, c.minor_units) <> l.line_total`,
  },
  {
    name: 'header_totals',
    description: 'Document subtotal / grand total = Σ line totals (cancelled sales lines excluded)',
    sql: `
      SELECT 'sales_orders' AS tbl, d.id FROM sales_orders d
        WHERE d.subtotal <> (SELECT COALESCE(SUM(line_total), 0) FROM sales_order_lines
                              WHERE sales_order_id = d.id AND line_status <> 'CANCELLED')
           OR d.grand_total <> d.subtotal
      UNION ALL
      SELECT 'purchase_orders', d.id FROM purchase_orders d
        WHERE d.subtotal <> (SELECT COALESCE(SUM(line_total), 0) FROM purchase_order_lines WHERE purchase_order_id = d.id)
           OR d.grand_total <> d.subtotal
      UNION ALL
      SELECT 'quotations', d.id FROM quotations d
        WHERE d.subtotal <> (SELECT COALESCE(SUM(line_total), 0) FROM quotation_lines WHERE quotation_id = d.id)
           OR d.grand_total <> d.subtotal`,
  },
  {
    name: 'base_amounts',
    description: 'grand_total_base = round(grand_total × fx_rate, base minor units)',
    sql: `
      SELECT 'sales_orders' AS tbl, d.id FROM sales_orders d
        JOIN companies co ON co.id = d.company_id JOIN currencies c ON c.code = co.base_currency
        WHERE round(d.grand_total * d.fx_rate, c.minor_units) <> d.grand_total_base
      UNION ALL
      SELECT 'purchase_orders', d.id FROM purchase_orders d
        JOIN companies co ON co.id = d.company_id JOIN currencies c ON c.code = co.base_currency
        WHERE round(d.grand_total * d.fx_rate, c.minor_units) <> d.grand_total_base`,
  },
  {
    name: 'payment_schedules',
    description: 'Confirmed order schedules add up to 100% and to the order total',
    sql: `
      SELECT 'sales_orders' AS tbl, d.id FROM sales_orders d
        JOIN sales_order_payment_schedule s ON s.sales_order_id = d.id
        GROUP BY d.id HAVING SUM(s.percent) <> 100 OR SUM(s.amount) <> d.grand_total
      UNION ALL
      SELECT 'sales_orders_missing_schedule', d.id FROM sales_orders d
        WHERE d.status IN ('CONFIRMED', 'CLOSED') AND d.payment_term_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM sales_order_payment_schedule s WHERE s.sales_order_id = d.id)
      UNION ALL
      SELECT 'purchase_orders', d.id FROM purchase_orders d
        JOIN purchase_order_payment_schedule s ON s.purchase_order_id = d.id
        GROUP BY d.id HAVING SUM(s.percent) <> 100 OR SUM(s.amount) <> d.grand_total`,
  },
  {
    name: 'payment_terms',
    description: 'Payment term installments add up to 100%',
    sql: `SELECT t.id FROM payment_terms t JOIN payment_term_installments i ON i.payment_term_id = t.id
          GROUP BY t.id HAVING SUM(i.percent) <> 100`,
  },
  {
    name: 'allocation_caps',
    description: 'No SO line or PO line is over-allocated',
    sql: `
      SELECT 'so_line' AS kind, l.id FROM sales_order_lines l
        WHERE (SELECT COALESCE(SUM(qty_base), 0) FROM order_allocations a WHERE a.sales_order_line_id = l.id)
              > l.qty_base * (100 + l.tolerance_pct) / 100
      UNION ALL
      SELECT 'po_line', l.id FROM purchase_order_lines l
        WHERE (SELECT COALESCE(SUM(qty_base), 0) FROM order_allocations a WHERE a.purchase_order_line_id = l.id)
              > l.qty_base`,
  },
  {
    name: 'allocations_on_live_documents',
    description: 'Allocations only link confirmed, non-cancelled sales orders to non-cancelled POs',
    sql: `
      SELECT a.id FROM order_allocations a
        JOIN sales_order_lines sl ON sl.id = a.sales_order_line_id
        JOIN sales_orders so ON so.id = sl.sales_order_id
        JOIN purchase_order_lines pl ON pl.id = a.purchase_order_line_id
        JOIN purchase_orders po ON po.id = pl.purchase_order_id
        WHERE so.status NOT IN ('CONFIRMED', 'ON_HOLD', 'CLOSED') OR po.status = 'CANCELLED'`,
  },
  {
    name: 'confirmed_orders_credit_checked',
    description: 'Every confirmed order has a passing credit check or an override',
    sql: `
      SELECT so.id FROM sales_orders so
        WHERE so.confirmed_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM credit_checks cc LEFT JOIN credit_overrides co ON co.credit_check_id = cc.id
             WHERE cc.sales_order_id = so.id AND (cc.result = 'PASS' OR co.id IS NOT NULL))`,
  },
  {
    name: 'bank_account_four_eyes',
    description: 'Supplier bank accounts are approved by someone other than their creator',
    sql: `SELECT id FROM supplier_bank_accounts
          WHERE status = 'APPROVED' AND (approved_by_id IS NULL OR approved_by_id = created_by_id)`,
  },
  {
    name: 'document_sequences',
    description: 'Sequence counters are ahead of every number already issued',
    sql: `
      SELECT s.doc_type, s.year FROM document_sequences s
        WHERE s.doc_type = 'SO' AND EXISTS (
          SELECT 1 FROM sales_orders d WHERE d.company_id = s.company_id AND d.number LIKE s.prefix || '%'
            AND substring(d.number FROM length(s.prefix) + 1)::int >= s.next_value)
      UNION ALL
      SELECT s.doc_type, s.year FROM document_sequences s
        WHERE s.doc_type = 'PO' AND EXISTS (
          SELECT 1 FROM purchase_orders d WHERE d.company_id = s.company_id AND d.number LIKE s.prefix || '%'
            AND substring(d.number FROM length(s.prefix) + 1)::int >= s.next_value)`,
  },
  {
    name: 'variant_spec_hash_unique',
    description: 'Product variants have unique specifications per product',
    sql: `SELECT product_id, spec_hash FROM product_variants GROUP BY product_id, spec_hash HAVING COUNT(*) > 1`,
  },
];

export async function runIntegrityChecks(prisma: PrismaClient): Promise<IntegrityCheckResult[]> {
  const results: IntegrityCheckResult[] = [];
  for (const check of INTEGRITY_CHECKS) {
    const rows = await prisma.$queryRawUnsafe<unknown[]>(check.sql);
    results.push({ name: check.name, description: check.description, violations: rows.length, sample: rows.slice(0, 5) });
  }
  return results;
}
