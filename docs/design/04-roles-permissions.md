# 04 — User Roles & Permissions

## 1. Model
- **Permissions** are atomic codes: `<resource>.<action>`, e.g. `sales_order.create`,
  `invoice.post`, `payment.void`, `credit.override`.
- **Roles** are named bundles of permissions. The seven system roles below ship by default.
  Admins can create custom roles.
- A user can hold several roles. Their effective permissions are the union.
- **Sensitive-data permissions** filter fields, not just screens:
  - `finance.view_costs`: purchase prices, costs, margins and profit (everywhere: lists, exports, search, API).
  - `finance.view_balances`: AR/AP balances, cash position.
  - `party.view_bank_details`: supplier/company bank data.
- **Row scope** (optional per user): `sales.scope = own` limits a salesperson to their own customers and orders.
- Enforced in the API (guards + serializers). The UI only hides what the API already refuses.

## 2. Actions
`V` view · `C` create · `E` edit (drafts / master data) · `D` delete (drafts / unreferenced master data only) ·
`A` approve / post / confirm / void · `—` none

## 3. Permission matrix (defaults)

| Area | Admin | Management | Sales | Purchasing | Logistics | Finance | Viewer |
|---|---|---|---|---|---|---|---|
| Users, roles, settings | VCEDA | V | — | — | — | — | — |
| Customers | VCEDA | VCEA | VCE (own) | V | V | VE (credit, terms) | V |
| Customer credit limit | VCEA | VEA | V | — | — | VE | — |
| Credit override (limit exceeded) | A | A | — | — | — | A | — |
| Credit override (blocked / old overdue) | A | A | — | — | — | — | — |
| Suppliers | VCEDA | VCEA | V | VCE | V | VE | V |
| Supplier bank details | VEA | VEA | — | VC | — | VCEA (approve by 2nd person) | — |
| Products & specs | VCEDA | VCEA | VC | VCE | V | V | V |
| Quotations | VCEDA | VCEA | VCEDA (own) | V | V | V | V |
| Sales orders | VCEDA | VCEA | VCED + confirm (own) | V + allocate | V | V | V |
| Purchase orders | VCEDA | VCEA | V | VCEDA | V | V | V |
| Shipments & containers | VCEDA | VCEA | V | VCE | VCEDA | V | V |
| Shipping documents | VCEDA | VCE | V (own) | VCE | VCEDA | VC | V |
| Customer invoices | VCEDA | VCEA | V (own) | — | V | VCEDA (post) | V |
| Credit/debit notes | VCEA | VCEA | — | — | — | VCEA | — |
| Customer payments | VCEA | VA | V (own) | — | — | VCEA (void) | — |
| Supplier invoices & payments | VCEA | VA | — | VC (invoices) | VC (service invoices) | VCEA | — |
| Costs (estimates/actuals) | VCEA | VCEA | — | VCE | VCE | VCEA | — |
| Profitability / margins | V | V | — * | V | — | V | — |
| AR / AP / cash flow | V | V | V AR (own, no cost) | V AP | — | V | — |
| Inventory | VCEA | V | V | VCE | VCEA | V | V |
| Tasks | VCEDA | VCEDA | VCE (own) | VCE | VCE | VCE | V |
| Reports & export | V + export all | V + export | V (no cost) + export | V + export | V + export | V + export | V |
| Audit log | V | V | — | — | — | V (financial) | — |
| Exchange rates | VCEA | V | V | V | V | VCE | V |

\* Sales can be granted `finance.view_costs` per user if you want salespeople to see their margins.

## 4. Segregation of duties (recommended defaults)
- A supplier bank account created or changed by one user must be **approved by a different user**
  before it can be paid. This protects against payment-diversion fraud.
- The user who records a payment cannot void it without a second approver (configurable).
- Credit overrides above a configured amount require the Management role.
- Every override, void, cancel and credit note requires a written reason, stored in the audit log.

## 5. Audit log coverage
Logged with before/after values: all changes to customers (esp. credit limit, payment terms,
status), suppliers and bank details, prices on orders, order confirmations/cancellations,
allocations, shipment dates (ETD/ETA/BL date), invoice posting/credit notes, payments and voids,
cost entries, exchange-rate overrides, user/role changes, logins and failed logins.
