# 07 — Development Phases, Risks & Suggested Improvements

## 1. Development phases

Your phase plan is kept, with a few foundations pulled into Phase 1 because every later phase depends
on them (currencies and FX, payment terms, audit log, numbering).

### Phase 1 — Foundation, master data, orders
- Monorepo, CI (lint, typecheck, tests, migration check), Docker Compose dev environment.
- Auth (login, sessions, password reset, optional TOTP), users, roles, permission guards, **audit log**.
- Company settings, **base currency**, currencies, **exchange rates** (manual entry + CSV).
- Countries, ports, incoterms, **payment terms engine** (installments, due-date calculation).
- Customers (contacts, addresses, credit limit, terms), suppliers (types, bank details with approval).
- Product catalog: categories, attribute definitions, products, variants/specs, units, packaging.
- Quotations (revisions, convert to SO).
- Sales orders (lines, specs, confirmation, schedule snapshot, **basic credit check** against open orders).
- Purchase orders, **SO↔PO allocations**, "awaiting purchase" queue, milestones.
- Document numbering, global search (customers/suppliers/SO/PO/products), list filter/sort/export (Excel).
- CSV import for customers, suppliers and products.
- Demo data: customers in Egypt, Saudi Arabia, UAE, Jordan, Morocco, Europe and Africa; suppliers in Turkey and China;
  the five listed products; quotations, SOs and POs in varied states.
- **Tests:** totals, due dates, FX conversion, allocation caps, permissions, and derived purchase status.

### Phase 2 — Logistics, documents, invoicing, payments
Shipments (direct/inbound/outbound, sea/road/air), containers and packing, shipment events, partial shipments,
documents with versions and requirement checklists, customer invoices, credit/debit notes, invoice PDF,
customer payments with allocations, advances, bank charges, supplier invoices and payments,
opening-balance import for unpaid invoices. **Tests:** partial shipments, remaining qty, invoice totals,
partial payments, outstanding balances, cross-currency allocation, supplier balances.

### Phase 3 — AR, AP, credit control, cash flow, profitability
AR/AP open items and aging, customer statements, full credit exposure and overrides, cost entries,
cost templates, allocation engine, estimated vs actual profit, order financial summary, cash-flow forecast,
inventory and pipeline views. **Tests:** exposure, aging buckets, profit (estimate→actual), cash forecast,
and the **E2E chain** (SO → PO → shipment → invoice → partial payment → balance → profit).

### Phase 4 — Dashboard, reports, alerts, tasks
Dashboard, report catalogue with Excel/PDF export, alert engine and rules, tasks, communication templates,
audit-log viewer, Order 360 timeline polish.

### Phase 5 — Integrations
Email sending (SMTP/Gmail), WhatsApp Business API, FX rate feeds, shipment tracking API, Odoo/accounting
sync via outbox + external references, bank statement import (CSV/MT940/CAMT) with payment matching,
and a read-only AI assistant over the semantic views.

### After each phase (definition of done)
1. All automated tests green in CI (unit, integration against real Postgres, E2E for that phase's flows).
2. DB integrity check script: orphan rows, allocation caps, totals = Σ lines, base = amount × rate, no posted-row edits.
3. A calculation check against hand-worked spreadsheet examples.
4. A permission test matrix: each role × each endpoint, including cost-field redaction.
5. Bugs fixed, then a written summary of what was delivered, what changed, and known limits.

## 2. Risks & design problems (and the mitigation built in)

| # | Risk | Mitigation |
|---|---|---|
| 1 | **A single order status can't express reality** (partially purchased *and* partially shipped) | Status dimensions + computed display status ([06 §5](06-business-rules.md#5-quantities-partial-shipments-derived-statuses)) |
| 2 | **Due dates depend on events not yet known** (BL date, arrival) | `PENDING_EVENT` installments with estimated dates; auto-fixed when the event is recorded |
| 3 | **Loaded quantity ≠ ordered quantity** (bale weights, ±5% tolerance) | Invoice actual loaded qty; tolerance per line; close-short with reason |
| 4 | **FX volatility** (TRY, EGP) distorts profit and receivables | Rate frozen per document; realized FX separated from gross profit; unrealized view optional |
| 5 | **Cross-currency and net-of-charges payments** mis-state balances | Gross / bank charges / net fields; allocations store both currencies |
| 6 | **Advances received before any invoice** | Allocation to the SO; auto-applied on invoice posting |
| 7 | **Changing the base currency later** corrupts history | Locked after the first posted document |
| 8 | **Supplier bank-detail fraud** (payment diversion via fake emails) | Bank accounts need second-person approval; pay only approved accounts; alert on change |
| 9 | **Duplicate supplier invoices** | Unique (supplier, invoice no.) |
| 10 | **Concurrent allocation** over-commits a PO | Row locks + DB-level re-check |
| 11 | **Cost allocation disputes** (how to split a container's freight across two orders) | Explicit method per cost; manual override; locked at order close |
| 12 | **Scope creep into full accounting** (GL, VAT returns, statutory reports) | Out of scope: this is an operational sub-ledger. Statutory accounting stays in Odoo/accounting, fed by the outbox |
| 13 | **Data migration** from Excel (open orders, unpaid invoices) | Importers + opening-balance documents flagged `OPENING` |
| 14 | **Cost data leaking** via exports, search or the API to sales staff | Field redaction in the serializer layer, tested per role |
| 15 | **Derived numbers get slow** as data grows | Indexed views first; materialized views + nightly refresh only where measured |
| 16 | **Time zones** (Istanbul, Shanghai, Cairo) shift "today" and overdue days | Business dates are `date`; "today" is taken in the company timezone |
| 17 | **Not all cargo moves by sea** (trucks Turkey → Middle East/Europe) | `transport_mode` + generic transport document (BL / CMR / AWB) |
| 18 | **Future second legal entity** | `company_id` on all transactional tables from day one |

## 3. Suggested improvements to your requirements

1. **Status dimensions** instead of one status (above). This is the most important change.
2. **Treat service providers as suppliers.** Freight, customs and inspection invoices flow through AP
   and automatically become actual costs, so there is no double entry.
3. **Letters of credit & CAD tracking.** These are common for Egypt, Morocco and Africa. Record the LC number,
   issuing bank, amount, expiry, latest shipment date and presentation deadline (typically 21 days after BL),
   with alerts before each date. Basic fields in Phase 2; a full LC workflow later if needed.
4. **Country document requirements.** Make destination-specific rules configurable, for example
   Egypt's ACI/ACID pre-registration number, Saudi SABER certificates, or EUR.1/A.TR for Turkish-origin
   goods to the EU. These feed the "missing documents" alert. The exact rules should be confirmed with
   your forwarder or customs broker.
5. **Demurrage/detention free-time** tracking per container after arrival. A costly surprise otherwise.
6. **Price history per product/spec** (buy and sell, by supplier/customer) for faster, safer quoting.
   PSF prices move with PTA/MEG and oil.
7. **Credit insurance limits** (e.g. from a trade-credit insurer) as a second limit next to your own.
8. **Quality claims module** (later): claim, evidence photos, agreed compensation, then credit note to
   customer and debit note to supplier.
9. **Commission agents**: per-order commission rules that auto-create estimated commission costs.
10. **Opening balances** as a Phase 2 deliverable, so go-live can happen mid-year.
11. **Frozen profit snapshot at order close**, so historical margins don't drift when rates or allocations change.
12. **Container number validation** (ISO 6346 check digit) and BL-number uniqueness warnings.
13. **Two-person rule** for voids, large credit overrides and supplier bank changes.
14. **Semantic views as the AI layer**, instead of letting a future AI query raw tables.
