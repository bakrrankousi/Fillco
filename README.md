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

**Phase 1 complete:** sign-in, users and roles, audit log, customers (with credit control), suppliers
(with four-eyes bank-detail approval), products with flexible specifications, quotations, sales orders,
purchase orders with back-to-back allocation to customer orders, global search and a first dashboard.
Phase 2 (shipments, documents, invoices, payments) is next.

## Running on your own computer

### 1. Install three free programs (once)

| Program            | Where to get it                                 | Why                |
| ------------------ | ----------------------------------------------- | ------------------ |
| **Node.js 22 LTS** | https://nodejs.org (the "LTS" button)           | Runs the app       |
| **Docker Desktop** | https://www.docker.com/products/docker-desktop  | Runs the database  |
| **Git** (optional) | https://git-scm.com (only if you don't use ZIP) | Downloads the code |

Open Docker Desktop once after installing it and leave it running.

### 2. Download the code

On GitHub open this repository, pick the branch (e.g. `claude/confident-edison-v2n5az`) in the branch
menu, then **Code → Download ZIP** and unzip it. Or with Git:

```bash
git clone -b claude/confident-edison-v2n5az https://github.com/bakrrankousi/fillco.git
```

### 3. First-time setup

Open a terminal in the project folder (Windows: right-click the folder → "Open in Terminal";
Mac: Terminal, then `cd` into the folder) and run these one by one:

```bash
npm install -g pnpm@10        # the package manager this project uses
cp .env.example .env          # Windows: copy .env.example .env
docker compose up -d          # starts the PostgreSQL database
pnpm install                  # downloads the libraries (a few minutes)
pnpm build                    # builds the app
pnpm db:migrate               # creates the database tables
pnpm db:seed                  # adds roles, users and demo data
```

### 4. Start the app

```bash
pnpm start
```

Open **http://localhost:3000** in your browser. Stop the app with `Ctrl + C`. Next time, only
Docker Desktop must be running and `pnpm start` is enough.

Demo users all use the password `Fillco-Demo-2026`:

| User                         | Role       |
| ---------------------------- | ---------- |
| `admin@fillco.local`         | Admin      |
| `omar.haddad@fillco.local`   | Management |
| `selin.kaya@fillco.local`    | Sales      |
| `karim.mansour@fillco.local` | Sales      |
| `wei.chen@fillco.local`      | Purchasing |
| `emre.demir@fillco.local`    | Logistics  |
| `nadia.farouk@fillco.local`  | Finance    |
| `viewer@fillco.local`        | Viewer     |

**If something goes wrong:** `port 5432 is already allocated` means another PostgreSQL is running on
your computer; stop it or change the port in `docker-compose.yml` and `.env`. `pnpm: command not found`
means step 3's first line failed; close and reopen the terminal and try again. Developers can use
`pnpm dev` for automatic reloading while editing.

## Checks

```bash
pnpm lint && pnpm typecheck
pnpm test          # domain + contract unit tests, API integration tests (uses TEST_DATABASE_URL)
pnpm db:check      # database integrity checks (totals, allocation caps, sequences, …)
pnpm test:e2e      # Playwright end-to-end tests against the seeded demo database
```

## Layout

| Path                 | Contents                                                           |
| -------------------- | ------------------------------------------------------------------ |
| `apps/api`           | NestJS API: auth, RBAC, audit, business modules, demo seed         |
| `apps/web`           | Next.js web app                                                    |
| `packages/domain`    | Pure business rules: money, FX, payment terms, credit, allocations |
| `packages/contracts` | Shared validation schemas, DTOs and permissions                    |
| `packages/db`        | Prisma schema, migrations, DB triggers/views, bootstrap, integrity |
| `e2e`                | Playwright tests covering the deal chain across roles              |

## Design documents

| Document                                                                         | Contents                                                      |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [00 — Overview & open questions](docs/design/00-overview.md)                     | Summary, key decisions, questions to answer before Phase 1    |
| [01 — System architecture & tech stack](docs/design/01-architecture.md)          | Architecture, module boundaries, conventions, stack           |
| [02 — Data model / ERD](docs/design/02-data-model.md)                            | Tables, relationships, ERDs, reporting views                  |
| [03 — Main workflows](docs/design/03-workflows.md)                               | Quote-to-cash and procure-to-pay flows                        |
| [04 — Roles & permissions](docs/design/04-roles-permissions.md)                  | Roles, permission matrix, data scoping                        |
| [05 — Screens & navigation](docs/design/05-screens.md)                           | Page structure, Order 360 view, search                        |
| [06 — Core business rules](docs/design/06-business-rules.md)                     | Formulas: due dates, AR status, credit, profit, FX, cash flow |
| [07 — Phases, risks & improvements](docs/design/07-phases-risks-improvements.md) | Delivery plan, risks, suggested improvements                  |
