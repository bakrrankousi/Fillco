-- Integrity rules that must hold no matter which code path writes the data,
-- plus the first reporting views of the semantic layer.

-- ───────────── CHECK constraints ─────────────

ALTER TABLE exchange_rates
  ADD CONSTRAINT exchange_rates_rate_positive CHECK (rate > 0),
  ADD CONSTRAINT exchange_rates_distinct_currencies CHECK (from_currency <> to_currency);

ALTER TABLE payment_term_installments
  ADD CONSTRAINT payment_term_installments_percent_range CHECK (percent > 0 AND percent <= 100),
  ADD CONSTRAINT payment_term_installments_seq_positive CHECK (seq > 0);

ALTER TABLE customers
  ADD CONSTRAINT customers_credit_limit_non_negative CHECK (credit_limit >= 0);

ALTER TABLE companies
  ADD CONSTRAINT companies_tolerance_range CHECK (default_tolerance_pct >= 0 AND default_tolerance_pct <= 100),
  ADD CONSTRAINT companies_block_days_non_negative CHECK (block_overdue_days >= 0);

ALTER TABLE uoms ADD CONSTRAINT uoms_factor_positive CHECK (factor_to_base > 0);

ALTER TABLE quotation_lines
  ADD CONSTRAINT quotation_lines_qty_positive CHECK (qty > 0 AND qty_base > 0),
  ADD CONSTRAINT quotation_lines_price_non_negative CHECK (unit_price >= 0 AND line_total >= 0),
  ADD CONSTRAINT quotation_lines_discount_range CHECK (discount_pct >= 0 AND discount_pct <= 100);

ALTER TABLE sales_orders
  ADD CONSTRAINT sales_orders_fx_rate_positive CHECK (fx_rate > 0),
  ADD CONSTRAINT sales_orders_totals_non_negative CHECK (grand_total >= 0 AND grand_total_base >= 0);

ALTER TABLE sales_order_lines
  ADD CONSTRAINT sales_order_lines_qty_positive CHECK (qty > 0 AND qty_base > 0),
  ADD CONSTRAINT sales_order_lines_price_non_negative CHECK (unit_price >= 0 AND line_total >= 0),
  ADD CONSTRAINT sales_order_lines_discount_range CHECK (discount_pct >= 0 AND discount_pct <= 100),
  ADD CONSTRAINT sales_order_lines_tolerance_range CHECK (tolerance_pct >= 0 AND tolerance_pct <= 100);

ALTER TABLE sales_order_payment_schedule
  ADD CONSTRAINT so_schedule_amount_non_negative CHECK (amount >= 0),
  ADD CONSTRAINT so_schedule_percent_range CHECK (percent > 0 AND percent <= 100),
  ADD CONSTRAINT so_schedule_fixed_has_date CHECK (due_status <> 'FIXED' OR due_date IS NOT NULL);

ALTER TABLE purchase_orders
  ADD CONSTRAINT purchase_orders_fx_rate_positive CHECK (fx_rate > 0),
  ADD CONSTRAINT purchase_orders_totals_non_negative CHECK (grand_total >= 0 AND grand_total_base >= 0);

ALTER TABLE purchase_order_lines
  ADD CONSTRAINT purchase_order_lines_qty_positive CHECK (qty > 0 AND qty_base > 0),
  ADD CONSTRAINT purchase_order_lines_price_non_negative CHECK (unit_price >= 0 AND line_total >= 0),
  ADD CONSTRAINT purchase_order_lines_discount_range CHECK (discount_pct >= 0 AND discount_pct <= 100);

ALTER TABLE purchase_order_payment_schedule
  ADD CONSTRAINT po_schedule_amount_non_negative CHECK (amount >= 0),
  ADD CONSTRAINT po_schedule_percent_range CHECK (percent > 0 AND percent <= 100),
  ADD CONSTRAINT po_schedule_fixed_has_date CHECK (due_status <> 'FIXED' OR due_date IS NOT NULL);

ALTER TABLE order_allocations
  ADD CONSTRAINT order_allocations_qty_positive CHECK (qty_base > 0);

ALTER TABLE supplier_bank_accounts
  ADD CONSTRAINT supplier_bank_accounts_has_account CHECK (iban IS NOT NULL OR account_number IS NOT NULL),
  ADD CONSTRAINT supplier_bank_accounts_approval CHECK (
    (status = 'APPROVED') = (approved_by_id IS NOT NULL AND approved_at IS NOT NULL) OR status = 'REVOKED'
  );

-- ───────────── Immutable history ─────────────

CREATE FUNCTION fillco_reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: records are immutable', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION fillco_reject_change();

CREATE TRIGGER credit_checks_immutable
  BEFORE UPDATE OR DELETE ON credit_checks
  FOR EACH ROW EXECUTE FUNCTION fillco_reject_change();

CREATE TRIGGER credit_overrides_immutable
  BEFORE UPDATE OR DELETE ON credit_overrides
  FOR EACH ROW EXECUTE FUNCTION fillco_reject_change();

-- Only drafts may be deleted; everything else is cancelled so the history stays.
CREATE FUNCTION fillco_only_delete_drafts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status::text <> 'DRAFT' THEN
    RAISE EXCEPTION 'Only draft records can be deleted from % (status is %); cancel instead',
      TG_TABLE_NAME, OLD.status USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER quotations_delete_drafts_only BEFORE DELETE ON quotations
  FOR EACH ROW EXECUTE FUNCTION fillco_only_delete_drafts();
CREATE TRIGGER sales_orders_delete_drafts_only BEFORE DELETE ON sales_orders
  FOR EACH ROW EXECUTE FUNCTION fillco_only_delete_drafts();
CREATE TRIGGER purchase_orders_delete_drafts_only BEFORE DELETE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION fillco_only_delete_drafts();

-- ───────────── Allocation caps (re-checked at commit) ─────────────
-- Σ allocations per sales order line ≤ ordered qty × (1 + tolerance)
-- Σ allocations per purchase order line ≤ PO line qty

CREATE FUNCTION fillco_check_so_line_allocation(p_line uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_allocated numeric;
  v_cap numeric;
BEGIN
  SELECT COALESCE(SUM(a.qty_base), 0) INTO v_allocated FROM order_allocations a WHERE a.sales_order_line_id = p_line;
  SELECT l.qty_base * (100 + l.tolerance_pct) / 100 INTO v_cap FROM sales_order_lines l WHERE l.id = p_line;
  IF v_cap IS NOT NULL AND v_allocated > v_cap THEN
    RAISE EXCEPTION 'Sales order line % over-allocated: % > %', p_line, v_allocated, v_cap
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE FUNCTION fillco_check_po_line_allocation(p_line uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_allocated numeric;
  v_cap numeric;
BEGIN
  SELECT COALESCE(SUM(a.qty_base), 0) INTO v_allocated FROM order_allocations a WHERE a.purchase_order_line_id = p_line;
  SELECT l.qty_base INTO v_cap FROM purchase_order_lines l WHERE l.id = p_line;
  IF v_cap IS NOT NULL AND v_allocated > v_cap THEN
    RAISE EXCEPTION 'Purchase order line % over-allocated: % > %', p_line, v_allocated, v_cap
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE FUNCTION fillco_order_allocations_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fillco_check_so_line_allocation(NEW.sales_order_line_id);
  PERFORM fillco_check_po_line_allocation(NEW.purchase_order_line_id);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER order_allocations_caps
  AFTER INSERT OR UPDATE ON order_allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fillco_order_allocations_check();

CREATE FUNCTION fillco_so_line_qty_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fillco_check_so_line_allocation(NEW.id);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER sales_order_lines_allocation_caps
  AFTER UPDATE OF qty_base, tolerance_pct ON sales_order_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fillco_so_line_qty_check();

CREATE FUNCTION fillco_po_line_qty_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fillco_check_po_line_allocation(NEW.id);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER purchase_order_lines_allocation_caps
  AFTER UPDATE OF qty_base ON purchase_order_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fillco_po_line_qty_check();

-- ───────────── Reporting views (semantic layer) ─────────────

CREATE VIEW v_so_line_fulfillment AS
SELECT
  l.id                         AS sales_order_line_id,
  so.id                        AS sales_order_id,
  so.number                    AS sales_order_number,
  so.company_id,
  so.customer_id,
  so.status                    AS order_status,
  l.line_no,
  l.variant_id,
  v.product_id,
  l.description,
  l.line_status,
  l.qty_base                   AS ordered_qty_kg,
  l.tolerance_pct,
  COALESCE(a.committed, 0)     AS purchased_committed_kg,
  COALESCE(a.pending, 0)       AS purchased_pending_kg,
  COALESCE(a.committed, 0) + COALESCE(a.pending, 0) AS purchased_kg,
  CASE WHEN l.line_status = 'OPEN'
       THEN GREATEST(l.qty_base - COALESCE(a.committed, 0) - COALESCE(a.pending, 0), 0)
       ELSE 0 END              AS remaining_to_purchase_kg,
  l.unit_price,
  l.uom,
  l.line_total,
  so.currency
FROM sales_order_lines l
JOIN sales_orders so ON so.id = l.sales_order_id
JOIN product_variants v ON v.id = l.variant_id
LEFT JOIN LATERAL (
  SELECT
    SUM(al.qty_base) FILTER (WHERE po.status IN ('CONFIRMED', 'IN_PRODUCTION', 'READY', 'CLOSED')) AS committed,
    SUM(al.qty_base) FILTER (WHERE po.status IN ('DRAFT', 'SENT'))                                  AS pending
  FROM order_allocations al
  JOIN purchase_order_lines pl ON pl.id = al.purchase_order_line_id
  JOIN purchase_orders po ON po.id = pl.purchase_order_id
  WHERE al.sales_order_line_id = l.id AND po.status <> 'CANCELLED'
) a ON TRUE;

COMMENT ON VIEW v_so_line_fulfillment IS
  'One row per sales order line: ordered vs purchased quantities in KG. purchased_committed_kg counts allocations to supplier-confirmed POs; purchased_pending_kg counts draft/sent POs.';

CREATE VIEW v_orders_awaiting_purchase AS
SELECT f.*
FROM v_so_line_fulfillment f
WHERE f.order_status = 'CONFIRMED'
  AND f.line_status = 'OPEN'
  AND f.remaining_to_purchase_kg > 0;

COMMENT ON VIEW v_orders_awaiting_purchase IS
  'Confirmed customer order lines that still need to be purchased from a supplier (answers: which orders have not yet been purchased?).';

CREATE VIEW v_po_line_allocation AS
SELECT
  pl.id                       AS purchase_order_line_id,
  po.id                       AS purchase_order_id,
  po.number                   AS purchase_order_number,
  po.company_id,
  po.supplier_id,
  po.status                   AS po_status,
  pl.line_no,
  pl.variant_id,
  pl.description,
  pl.qty_base                 AS qty_kg,
  COALESCE(SUM(a.qty_base), 0) AS allocated_kg,
  pl.qty_base - COALESCE(SUM(a.qty_base), 0) AS unallocated_kg,
  pl.unit_price,
  pl.uom,
  pl.line_total,
  po.currency,
  po.expected_ready_date
FROM purchase_order_lines pl
JOIN purchase_orders po ON po.id = pl.purchase_order_id
LEFT JOIN order_allocations a ON a.purchase_order_line_id = pl.id
GROUP BY pl.id, po.id;

COMMENT ON VIEW v_po_line_allocation IS
  'One row per purchase order line with allocated and unallocated (stock) quantity in KG.';

CREATE VIEW v_sales_order_summary AS
SELECT
  so.id                  AS sales_order_id,
  so.number,
  so.company_id,
  so.customer_id,
  c.company_name         AS customer_name,
  c.country_code         AS customer_country,
  so.order_date,
  so.status,
  so.currency,
  so.grand_total,
  so.fx_rate,
  so.grand_total_base,
  so.salesperson_id,
  so.destination_country,
  so.requested_shipment_date,
  COALESCE(SUM(f.ordered_qty_kg) FILTER (WHERE f.line_status <> 'CANCELLED'), 0)          AS ordered_kg,
  COALESCE(SUM(f.purchased_kg) FILTER (WHERE f.line_status <> 'CANCELLED'), 0)            AS purchased_kg,
  COALESCE(SUM(f.remaining_to_purchase_kg), 0)                                              AS remaining_to_purchase_kg
FROM sales_orders so
JOIN customers c ON c.id = so.customer_id
LEFT JOIN v_so_line_fulfillment f ON f.sales_order_id = so.id
GROUP BY so.id, c.id;

COMMENT ON VIEW v_sales_order_summary IS
  'One row per sales order with customer, value in document and base currency, and purchasing progress in KG.';
