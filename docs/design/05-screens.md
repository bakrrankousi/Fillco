# 05 — Screens & Page Structure

## 1. Layout
- Left sidebar navigation (collapsible), a top bar with **global search (Ctrl/⌘ K)**, the alerts bell,
  a "+ New" menu and the user menu.
- Desktop-first, dense data tables. Tablet/phone layouts collapse tables into cards.
- Status badge colors (used consistently everywhere):

| Meaning | Color | Examples |
|---|---|---|
| Normal / in progress | Blue / neutral | Confirmed, In transit, Not due |
| Warning | Amber | Due soon, ETA in 3 days, Credit > 90% used |
| Overdue | Orange-red | Overdue 1–30 |
| Critical | Red | Overdue > 60, Credit blocked, Missing BL after departure |
| Completed | Green | Paid, Delivered, Completed |
| Cancelled / inactive | Grey | Cancelled, Archived |

## 2. Navigation & pages

| Menu | List page (default columns · key filters) | Detail page tabs |
|---|---|---|
| **Dashboard** | KPI tiles + a few charts (see §4) | — |
| **Customers** | Code, name, country, salesperson, terms, credit limit, outstanding, overdue, available credit, status · country, salesperson, status, overdue only | Overview · Credit & exposure · Orders · Invoices & payments (statement) · Shipments · Documents · Tasks · Activity |
| **Suppliers** | Code, name, type, country, currency, open POs, balance owed, overdue · type, country | Overview · POs · Invoices & payments · Bank details · Performance (lead time, delays) · Activity |
| **Products** | Code, name, category, base unit, active · category | Overview · Specs & variants · Price history (buy/sell) · Stock & pipeline |
| **Quotations** | No., rev, customer, date, valid until, value, status | Lines · Revisions · PDF · Activity |
| **Sales Orders** | No., customer, date, value, display status, purchased %, shipped %, invoiced %, paid %, ETA · status dimensions, customer, salesperson, country, product, date | **Order 360** (§3) |
| **Purchases** | No., supplier, date, value, ready date, status, allocated SOs, paid % · supplier, status, delayed | Lines & allocations · Milestones · Shipments · Supplier invoices & payments · Documents |
| **Shipments** | No., customer, supplier, containers, BL, vessel, POL→POD, ETD, ETA, status, delay days, docs complete · status, mode, route, ETA range | Overview · Lines & containers (packing) · Events timeline · Documents checklist · Costs · Invoice & payment · Profit |
| **Inventory** | Variant, warehouse/stage, lot, container, qty, reserved, available, value · stage (purchased / in transit / stock), product | Movements ledger |
| **Invoices** | No., customer, date, due, total, paid, outstanding, AR status | Lines · Installments · Payments · Credit notes · PDF |
| **Receivables** | AR open items + aging matrix + customer statement | — |
| **Payables** | AP open items + supplier aging | — |
| **Cash Flow** | Current cash by bank account; forecast Today / 7 / 30 / 60 / 90 days, drill-down to items | — |
| **Profitability** | By order / customer / product / shipment / month / year, estimated vs actual | — |
| **Tasks** | My tasks, team tasks, overdue · assignee, type, related entity | — |
| **Reports** | Report catalogue (see [06 §10](06-business-rules.md#10-reports-catalogue)) with filters + Excel/PDF export | — |
| **Documents** | All documents across entities · type, shipment, customer, missing | Versions |
| **Settings** | Company & base currency, users & roles, currencies & rates, payment terms, ports, incoterms, cost types & templates, document types & requirements, product attributes, alert rules, templates, numbering | — |

Every list has column choice, multi-filter, sort, saved views ("My overdue customers") and export.

## 3. Order 360 view (Sales Order detail)

One screen, top to bottom:

```
┌ SO-2026-00125 · Nile Home Textiles (EG) · Confirmed · ◐ Partially shipped · Invoiced 40% · Paid 20% ┐
│ Order date · Salesperson · Incoterm CFR Alexandria · Terms: 30% adv / 70% 60d after BL · Credit ✓   │
├─ ORDER ───────────────────────┬─ PURCHASE ─────────────────────────┬─ SHIPMENT ───────────────────┤
│ Lines: product + spec, qty,   │ PO-2026-00451 · Supplier (TR) ·     │ SHP-… · 2×40HC · BL … ·       │
│ price, ordered/purchased/     │ qty · cost* · ready date · paid %  │ ETD · ETA · status · delay    │
│ shipped/invoiced progress bar │ PO-2026-00460 · Supplier (CN) …    │ Remaining to ship: 60 MT     │
├─ FINANCE* ────────────────────┴───────────────┬─ DOCUMENTS ────────┴──────────────────────────────┤
│ Sales · Purchase · Freight · Other · Profit   │ CI ✓ PL ✓ BL ✓ COO ✗ COA ✓ (per shipment)        │
│ (estimated | actual | variance) · Margin %    │                                                  │
│ Invoiced · Collected · Outstanding · Overdue  ├─ TASKS ─────────────────────────────────────────┤
│ Supplier paid / owed · Cash invested /        │ Request COO (due today) · Follow up advance …    │
│ recovered / tied up                           │                                                  │
├─ TIMELINE ────────────────────────────────────┴──────────────────────────────────────────────────┤
│ Quotation Q-…r2 → Confirmed → PO created → Production done → Booked → Loaded → Departed →        │
│ Arrived → Delivered → INV-… issued → PAY-… received (each with date, user, link)                 │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
* shown only with finance.view_costs
```

The **Shipment detail** page mirrors this from the shipment's side: suppliers, POs, customers,
SOs, invoices, payment status and shipment profit.

## 4. Dashboard (restrained)
- **Row 1 KPIs:** Open sales orders (value) · Awaiting purchase · Shipments on the water ·
  AR outstanding / overdue · AP due in 30 days · Projected cash in 30 days.
- **Row 2:** Shipment pipeline (count per stage from Preparing to Delivered) · AR aging bar ·
  Cash forecast 7/30/60/90 (in / out / net).
- **Row 3:** Profit this month/year (expected vs actual) · Top 5 customers by outstanding · Top 5 products by profit.
- **Row 4:** Overdue tasks · Open critical alerts.
- Every tile links to the filtered list behind it. A role without finance permissions sees the operational tiles only.

## 5. Global search
One box searches customers, suppliers (name, phone, email), SO/PO/invoice/payment/shipment numbers,
container numbers, BL numbers and products. Results are grouped by type, use typo-tolerant matching
(trigram), respect permissions, and open with the keyboard.
