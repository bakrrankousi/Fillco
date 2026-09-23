# 06 — Core Business Rules & Calculations

All calculations live in `@fillco/domain` as pure functions with unit tests.
Money uses `Decimal`, rounded half-up to the currency's minor units at **line** level;
totals are sums of rounded lines.

## 1. Order, purchase and invoice totals
```
line_total      = round( qty × unit_price × (1 − discount_pct/100) )
subtotal        = Σ product line_total
grand_total     = subtotal − header_discount + freight + insurance + other_charges + tax
tax             = Σ round(line_total × tax_rate)          (export sales are usually 0%)
qty_base        = qty × uom_factor(uom → KG)              (MT → ×1000)
```
Price follows the line unit: 1,150 USD/MT × 24 MT = 27,600 USD.

## 2. Payment terms & due dates
- A term is a list of installments `{percent, trigger_event, offset_days}`. Percentages must sum to 100.
- `due_date = trigger_date + offset_days` (calendar days). Optional setting: roll forward to the next business day.
- If the trigger has not happened yet, `due_date = NULL`, `due_status = PENDING_EVENT`, and
  `estimated_due_date` uses the planned date (BL date ≈ ETD, ARRIVAL ≈ ETA, INVOICE ≈ planned ship date).
  When the event is recorded, the due date becomes fixed automatically (audited).
- Installment amounts: `round(total × percent)`. The **last** installment takes the rounding remainder.

| Example | Result |
|---|---|
| Invoice 1 Sep 2026, "60 days from invoice" | due **31 Oct 2026** |
| "30% advance, 70% against BL", order 100,000 | 30,000 due at confirmation; 70,000 due on BL date (pending until the BL is issued) |
| "20% advance, 80% 60 days after BL", BL date 5 Oct 2026 | 80% due **4 Dec 2026** |
| Cash in advance | 100% `ORDER_CONFIRMATION`, offset 0 |
| CAD (cash against documents) | 100% `BL_DATE` (docs presented), offset 0–7 |

## 3. Receivables (AR) status & aging
Evaluated **per installment**. The invoice shows its worst installment.
```
paid         = Σ active allocations to the installment (in invoice currency)
outstanding  = amount − paid − credit notes applied
days_to_due  = due_date − today          days_overdue = max(0, today − due_date)
```
Status precedence (first match wins):
1. **Paid**: outstanding ≤ 0.01 (or ≤ configured write-off tolerance)
2. **Overdue**: today > due_date
3. **Due Today**: today = due_date
4. **Due Soon**: 1 ≤ days_to_due ≤ 7 (configurable)
5. **Partially Paid**: paid > 0
6. **Not Due** (incl. *Awaiting BL/arrival* when the due date is pending)

A "partially paid" flag is also shown next to Overdue/Due Soon when paid > 0.

**Aging buckets** (by days_overdue of the open amount): Current (not yet due) · 1–30 · 31–60 · 61–90 · 91–120 · 120+.
AP uses identical rules on supplier installments.

Example: invoice 50,000, payment 20,000 → outstanding **30,000**. Invoice 100,000, payments
30,000 + 40,000 + 30,000 → outstanding 0 → **Paid**.

## 4. Customer credit control
All amounts are converted to the credit-limit currency at today's rate.
```
open_ar            = Σ outstanding of posted invoices (overdue + not yet due)
open_orders        = Σ uninvoiced value of CONFIRMED sales orders
                     (remaining qty × net price, incl. goods already shipped but not yet invoiced)
pending_shipments  = part of open_orders already loaded/in transit (shown separately, informational)
unapplied_credit   = unallocated customer payments + advances received on open orders
exposure           = open_ar + open_orders − unapplied_credit
available_credit   = credit_limit − exposure
secured_pct        = % of the new order due on ORDER_CONFIRMATION / BEFORE_LOADING (advance / CAD before loading)
new_order_unsecured= new_order_value × (100 − secured_pct) / 100
available_after    = available_credit − new_order_unsecured
```
The advance part of an order is secured by its payment terms and does not consume credit.
Example: limit 100,000, outstanding 60,000, new order 30,000 → available before 40,000,
**after 10,000** → PASS. A new order of 45,000 → after −5,000 → **WARN** (override required).

Result rules: `BLOCK` if the customer is BLOCKED/ON_HOLD, or has any amount overdue more than N days (default 30);
`WARN` if `available_after < 0`; otherwise `PASS`. A credit limit of 0 with cash-in-advance terms means
"no credit" and does not warn when the advance covers 100%. Confirming past a `WARN` needs `credit.override`
(Admin, Management, Finance); past a `BLOCK` needs `credit.override_block` (Admin, Management). Both require a
written reason and are stored immutably with the credit-check snapshot. The check runs on SO confirmation and again
(warning only) on shipment release for unpaid CAD/open-account orders.

## 5. Quantities, partial shipments, derived statuses
Per SO line:
```
ordered        = qty_base
purchased      = Σ order_allocations.qty_base (on non-cancelled POs)
shipped        = Σ shipment_lines.qty_base where shipment status ≥ LOADED
delivered      = Σ … where shipment status = DELIVERED
invoiced       = Σ posted invoice_lines.qty − credit-note qty
remaining_to_purchase = max(0, ordered − purchased)
remaining_to_ship     = max(0, ordered − shipped)       (0 if the line is closed short)
fully_shipped  ⇔ shipped ≥ ordered × (1 − tolerance) or line CLOSED_SHORT
```
Example: ordered 100 MT; shipment 1 loads 40 MT → shipped 40, **remaining 60**; shipment 2 loads 60 → remaining 0.

**Display status** (your list), computed from the stored commercial status and the quantities above:
`Cancelled` > `Completed` (closed) > `Delivered` > `Fully Shipped` > `Partially Shipped` >
`Preparing Shipment` (a shipment exists, not yet loaded) > `Fully Purchased` > `Partially Purchased` >
`Purchasing` (only on draft/sent POs) > `Purchase Required` (confirmed, nothing allocated) >
`Confirmed` > `Pending Customer Confirmation` > `Quotation/Draft`.
The separate dimensions (purchasing %, shipped %, invoiced %, paid %) stay visible and filterable.

## 6. Profit
All profit figures are in base currency.
```
revenue_estimated = Σ SO line totals × SO fx_rate
revenue_actual    = Σ posted invoice/credit-note lines × invoice fx_rate
cost_estimated    = product cost (allocated PO qty × PO price) + Σ ESTIMATE cost allocations
cost_actual       = product cost (supplier invoice price when posted) + Σ ACTUAL cost allocations
cost_current      = per cost type: actual if one exists for that target, else estimate
profit            = revenue − cost               margin % = profit / revenue × 100
```
Example: sales 100,000; purchase 70,000; est. freight 5,000; other 2,000 → **estimated profit 23,000 (23.0%)**.
After shipment, actual freight 5,600 and bank charges 150 → current profit 22,250 (22.25%).

- When an ACTUAL entry is posted for the same target and cost type, the matching ESTIMATE becomes `SUPERSEDED`.
- Realized FX gain/loss (see §7) is shown as a separate line below gross profit, not hidden inside revenue.
- Profit rolls up from SO lines to order, customer, product/variant, shipment (via shipment lines), month and year.

**Cash position per order**
```
cash_invested  = supplier payments attributable to the order (PO payments × allocated share) + costs paid
cash_recovered = customer receipts allocated to the order's invoices and advances
cash_tied_up   = cash_invested − cash_recovered          (negative = customer money is financing the deal)
```
**Capital tied up (company)** = Σ positive `cash_tied_up` over open orders + stock and pipeline purchased
for stock, at paid cost.

## 7. Currency
- Each document stores `currency`, amounts, `fx_rate` (base per 1 unit) and base totals. Originals are never overwritten.
- The default rate is the latest `exchange_rates` entry ≤ document date. A user override is allowed and audited.
- Base amounts on posted documents are **frozen**. Reports use the stored base amounts.
  An optional toggle revalues open balances at today's rate (unrealized, reporting only).
- Realized FX on settlement: `fx_diff_base = amount_invoice_ccy × (payment_rate − invoice_rate)`.
  Example: invoice EUR 10,000 at 1.08 = USD 10,800; paid when the rate is 1.10 = USD 11,000 → **FX gain USD 200**.
- The base currency is chosen at setup and locked once the first posted document exists.

## 8. Cash-flow forecast
```
current_cash = Σ bank accounts (opening + receipts − payments ± other cash movements), in base
incoming     = open AR installments (fixed or estimated due date)
             + uninvoiced SO schedule installments (estimated dates)
             + planned other income
outgoing     = open AP installments + uninvoiced PO schedule installments
             + ESTIMATE costs not yet invoiced (freight, customs…) at the estimated date
             + planned other expenses
projected(h) = current_cash + incoming(≤h) − outgoing(≤h)   for h ∈ {today, 7, 30, 60, 90} days (cumulative)
```
Overdue receivables are shown in a separate **"Overdue – timing uncertain"** row and are excluded from the
7-day inflow by default (toggle to include). Every item has a certainty tag: `FIXED`, `ESTIMATED`, `OVERDUE`.
Example: incoming 30 days 250,000; outgoing 180,000 → net **+70,000**.

## 9. Integrity rules (your list, and how each is enforced)
| # | Rule | Enforcement |
|---|---|---|
| 1–3 | SO ↔ many POs, SO ↔ many shipments, shipment ↔ many POs | `order_allocations`, `shipment_lines` M:N tables |
| 4 | Shipment ↔ many containers | `containers`, `container_contents` |
| 5 | Invoice ↔ one or many shipments | `invoice_lines.shipment_line_id` + `invoice_shipments` |
| 6–7 | Partial payments; one payment ↔ many invoices | `customer_payment_allocations` |
| 8–9 | Per-customer terms, automatic due dates | `payment_terms` + installment engine (§2) |
| 10 | Estimated vs actual | `cost_entries.nature` (§6) |
| 11–12 | Original currency and rate stored | monetary quartet on every document (§7) |
| 13 | Adjustments traceable | credit/debit notes, reversals, `audit_logs` with reasons |
| 14–15 | No silent deletes; reversal | DB triggers + no `DELETE` grant + void/credit-note workflows |

## 10. Reports catalogue
Sales by customer / product / country / month · Purchases by supplier / product · Gross profit ·
Profit by customer / product / shipment · AR aging · AP aging · Cash flow · Customer credit exposure ·
Supplier exposure (advances paid, open POs, balances) · Open orders · Unshipped orders · Orders awaiting
purchase · Shipments in transit · Shipment delays · Inventory · Goods in transit · Customer payment history
(incl. average days-to-pay) · Supplier payment history.

Common filters: date range, customer, supplier, country, product/category, salesperson, currency, status.
Export: Excel (typed cells, one sheet per section) and PDF (company letterhead). Cost/profit columns are
dropped from exports for users without `finance.view_costs`.
