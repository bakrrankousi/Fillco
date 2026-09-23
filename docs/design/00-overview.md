# 00 — Overview

## What we are building

A **transaction-centric** management system for an international trading company.
It is not a CRM or a stock app. The central object is the **deal chain**:

```
Sales Order line ──allocated to──▶ Purchase Order line ──shipped on──▶ Shipment line / Container
      │                                                                   │
      └──invoiced by──▶ Invoice line ◀──────────────────────────────────────┘
                              │
                              └──settled by──▶ Payment allocation ◀── Customer payment
```

Each link is a row in a table with a quantity or an amount. That gives us traceability from
the supplier to the customer's payment, partial quantities at every step, and profit computed
from real data instead of typed-in numbers.

## The ten design decisions that matter most

1. **Modular monolith.** One TypeScript API (NestJS) and one Next.js web app in a
   monorepo, both backed by PostgreSQL. It is easy to run and back up, and simple to split later.
2. **Pure domain package.** All money, due-date, aging, credit, allocation and profit
   calculations live in a framework-free `@fillco/domain` package with full unit-test coverage.
3. **Many-to-many links are first-class tables.** `order_allocations` (SO line ↔ PO line),
   `shipment_lines` (PO line / SO line ↔ shipment), `container_contents`,
   `customer_payment_allocations` (payment ↔ invoice) and `cost_allocations` (cost ↔ SO line).
4. **The order status is split into dimensions.** The status list you gave mixes several
   things. An order can be *partially purchased* and *partially shipped* at the same time.
   We store a manual **commercial status** and derive the **purchasing, shipping,
   invoicing and payment** statuses from quantities. The single "display status" you
   see uses your list and is computed from those dimensions.
5. **Payment terms are event-based installments.** For example, "30% at order, 70% against
   BL" or "20% advance, 80% 60 days after BL". An installment whose trigger event has not
   happened yet (no BL date) is *pending*. It gets an estimated date for the cash-flow
   forecast.
6. **Every monetary record stores four values:** original currency, original amount,
   exchange rate and base-currency amount. The original is never overwritten.
7. **Posted financial documents are immutable.** Corrections use credit notes and
   reversals. The database itself blocks deleting or updating posted rows, and every
   change is written to the audit log.
8. **Service providers are suppliers with a type** (forwarder, shipping line, customs
   broker, insurer, inspection, agent). A freight invoice becomes a normal payable and the
   **actual cost** for the shipment, so AP and profitability share one source.
9. **Costs have a nature: estimate or actual.** They are allocated down to the sales-order
   line, which lets profit roll up by order, customer, product, shipment, month or year.
10. **An AI-ready reporting layer.** Documented, read-only SQL views (`v_ar_open_items`,
    `v_order_profitability`, `v_cash_forecast`, …) are the stable "semantic layer" that
    reports, dashboards and a future AI assistant query.

## Questions for you before Phase 1

These answers change the implementation. Where you don't answer, the default is used.

| # | Question | Default if unanswered |
|---|---|---|
| 1 | **Base/reporting currency?** | USD |
| 2 | **One legal entity or several** (e.g. Turkey + UAE/Egypt)? | One company. The schema carries `company_id` so more can be added |
| 3 | **Mostly back-to-back direct shipments** (supplier → customer), or do you also hold warehouse stock? | Both supported; direct is the main flow |
| 4 | **Transport modes:** sea only, or also trucks from Turkey (CMR) or air? | Sea, road, air (generic "transport document") |
| 5 | **Payment instruments:** TT only, or also LC / CAD? | TT, CAD, LC (basic LC fields in Phase 2) |
| 6 | **Should Sales staff see purchase prices and margins?** | No. This needs the `finance.view_costs` permission |
| 7 | **Languages:** English only, or Arabic (RTL) / Turkish too? | English UI, i18n-ready |
| 8 | **Units:** sell in MT, buy in KG? Price per KG or per MT? | Base unit KG. Lines can use MT/KG, and price follows the line unit |
| 9 | **Hosting:** cloud VPS / managed Postgres, or your own server? | Docker on a VPS + managed Postgres with daily backups |
| 10 | **Existing data** (Excel customer lists, open orders, unpaid invoices) to import? | CSV importers for master data + opening balances in Phase 1/2 |
| 11 | **Odoo or accounting software in use today?** | None; integration via outbox in Phase 5 |
| 12 | **Numbering format** `SO-2026-00125`, `PO-…`, `INV-…`, `PAY-…`, `SHP-…` OK? | Yes, yearly reset, per company |
