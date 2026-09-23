# Fillco — Trading Company Management System

A transaction-centric management system for an international textile raw-material
trading business (PSF, HCS, microfiber, low-melt fiber, polyester yarn), buying
mainly from Turkey and China and selling worldwide.

It follows every deal end to end:

```
Supplier → Purchase Order → Production → Shipment → Documents → Customer Order
        → Customer Shipment → Invoice → Deferred Payment → Collection → Profit / Cash Flow
```

## Status

**Design phase. Awaiting approval before Phase 1 implementation.**

| Document | Contents |
|---|---|
| [00 — Overview & open questions](docs/design/00-overview.md) | Summary, key decisions, questions to answer before Phase 1 |
| [01 — System architecture & tech stack](docs/design/01-architecture.md) | Architecture, module boundaries, conventions, stack |
| [02 — Data model / ERD](docs/design/02-data-model.md) | Tables, relationships, ERDs, reporting views |
| [03 — Main workflows](docs/design/03-workflows.md) | Quote-to-cash and procure-to-pay flows |
| [04 — Roles & permissions](docs/design/04-roles-permissions.md) | Roles, permission matrix, data scoping |
| [05 — Screens & navigation](docs/design/05-screens.md) | Page structure, Order 360 view, search |
| [06 — Core business rules](docs/design/06-business-rules.md) | Formulas: due dates, AR status, credit, profit, FX, cash flow |
| [07 — Phases, risks & improvements](docs/design/07-phases-risks-improvements.md) | Delivery plan, risks, suggested improvements |
