/**
 * Response shapes returned by the API. Decimals are strings, business dates "YYYY-MM-DD",
 * timestamps ISO-8601. Cost fields are null when the user lacks finance.view_costs.
 */
import type {
  AddressType,
  AttributeDataType,
  BankAccountStatus,
  CreditResult,
  CustomerStatus,
  DimensionStatus,
  EnumOption,
  OrderLineStatus,
  PaymentInstrument,
  PoMilestone,
  PurchaseOrderStatus,
  QuotationStatus,
  SalesOrderStatus,
  SoDisplayStatus,
  SupplierStatus,
  SupplierType,
  TriggerEvent,
} from '@fillco/domain';
import type { Permission, RoleCode } from './permissions';

export type DecimalString = string;
export type DateString = string;
export type Timestamp = string;

export interface Ref {
  id: string;
  code?: string | null;
  name: string;
}

// ───────────── Identity ─────────────

export interface CompanyDto {
  id: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  address: string | null;
  city: string | null;
  countryCode: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  baseCurrency: string;
  /** False once confirmed documents exist. */
  baseCurrencyEditable: boolean;
  timezone: string;
  blockOverdueDays: number;
  defaultTolerancePct: DecimalString;
  invoiceFooter: string | null;
  version: number;
}

export interface MeDto {
  id: string;
  email: string;
  fullName: string;
  roles: RoleCode[];
  permissions: Permission[];
  mustChangePassword: boolean;
  company: { id: string; name: string; baseCurrency: string; timezone: string };
  csrfToken: string;
}

export interface UserDto {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  isActive: boolean;
  roles: RoleCode[];
  lastLoginAt: Timestamp | null;
  createdAt: Timestamp;
  version: number;
}

export interface RoleDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: Permission[];
  userCount: number;
}

export interface AuditLogDto {
  id: string;
  occurredAt: Timestamp;
  user: Ref | null;
  entityType: string;
  entityId: string;
  action: string;
  changes: unknown;
  reason: string | null;
}

export interface ActivityEventDto {
  id: string;
  occurredAt: Timestamp;
  eventType: string;
  entityType: string;
  entityId: string;
  summary: string;
  user: Ref | null;
}

// ───────────── Master data ─────────────

export interface CurrencyDto {
  code: string;
  name: string;
  symbol: string | null;
  minorUnits: number;
  isActive: boolean;
}

export interface ExchangeRateDto {
  id: string;
  rateDate: DateString;
  fromCurrency: string;
  toCurrency: string;
  rate: DecimalString;
  source: string;
  createdAt: Timestamp;
}

export interface CountryDto {
  code: string;
  name: string;
  region: string | null;
}

export interface PortDto {
  id: string;
  locode: string;
  name: string;
  countryCode: string;
  type: 'SEA' | 'AIR' | 'LAND' | 'INLAND';
  isActive: boolean;
}

export interface IncotermDto {
  code: string;
  name: string;
  description: string | null;
  sellerPaysMainCarriage: boolean;
  sellerPaysInsurance: boolean;
}

export interface UomDto {
  code: string;
  name: string;
  dimension: 'MASS' | 'COUNT' | 'LENGTH';
  factorToBase: DecimalString;
}

export interface PackagingTypeDto {
  id: string;
  code: string;
  name: string;
  nominalWeightKg: DecimalString | null;
}

export interface InstallmentDto {
  seq: number;
  percent: DecimalString;
  triggerEvent: TriggerEvent;
  offsetDays: number;
  instrument: PaymentInstrument | null;
}

export interface PaymentTermDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  summary: string;
  installments: InstallmentDto[];
  version: number;
}

/** Everything a form needs to render dropdowns, loaded once. */
export interface LookupsDto {
  baseCurrency: string;
  currencies: CurrencyDto[];
  countries: CountryDto[];
  ports: PortDto[];
  incoterms: IncotermDto[];
  uoms: UomDto[];
  packagingTypes: PackagingTypeDto[];
  paymentTerms: Pick<PaymentTermDto, 'id' | 'code' | 'name' | 'summary' | 'isActive'>[];
  users: Ref[];
}

// ───────────── Parties ─────────────

export interface ContactDto {
  id: string;
  name: string;
  position: string | null;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  isPrimary: boolean;
  notes: string | null;
}

export interface AddressDto {
  id: string;
  type: AddressType;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  countryCode: string;
  isDefault: boolean;
}

export interface CreditExposureDto {
  currency: string;
  creditLimit: DecimalString;
  /** Posted invoices outstanding (from Phase 2 invoicing). */
  openAr: DecimalString;
  overdueAmount: DecimalString;
  notYetDue: DecimalString;
  /** Uninvoiced value of confirmed orders. */
  openOrders: DecimalString;
  unappliedCredit: DecimalString;
  exposure: DecimalString;
  availableCredit: DecimalString;
  /** Exposure / limit in percent (null when the limit is 0). */
  utilizationPct: DecimalString | null;
}

export interface CustomerListItemDto {
  id: string;
  code: string;
  companyName: string;
  countryCode: string;
  city: string | null;
  status: CustomerStatus;
  defaultCurrency: string;
  paymentTerm: string | null;
  paymentTermId: string | null;
  defaultIncoterm: string | null;
  defaultDestinationPortId: string | null;
  creditLimit: DecimalString;
  creditLimitCurrency: string;
  salesperson: string | null;
  phone: string | null;
  email: string | null;
}

export interface CustomerDto {
  id: string;
  code: string;
  companyName: string;
  legalName: string | null;
  countryCode: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  website: string | null;
  taxId: string | null;
  vatNumber: string | null;
  defaultCurrency: string;
  paymentTerm: Ref | null;
  creditLimit: DecimalString;
  creditLimitCurrency: string;
  defaultIncoterm: string | null;
  defaultDestinationPort: Ref | null;
  salesperson: Ref | null;
  status: CustomerStatus;
  notes: string | null;
  contacts: ContactDto[];
  addresses: AddressDto[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
  version: number;
}

export interface SupplierListItemDto {
  id: string;
  code: string;
  companyName: string;
  supplierType: SupplierType;
  countryCode: string;
  city: string | null;
  status: SupplierStatus;
  defaultCurrency: string;
  paymentTerm: string | null;
  paymentTermId: string | null;
  defaultIncoterm: string | null;
  defaultLoadingPortId: string | null;
  productionLeadTimeDays: number | null;
  phone: string | null;
  email: string | null;
}

export interface BankAccountDto {
  id: string;
  bankName: string;
  accountName: string;
  accountNumber: string | null;
  iban: string | null;
  swift: string | null;
  currency: string;
  bankAddress: string | null;
  status: BankAccountStatus;
  notes: string | null;
  createdAt: Timestamp;
  createdBy: Ref | null;
  approvedBy: Ref | null;
  approvedAt: Timestamp | null;
}

export interface SupplierDto {
  id: string;
  code: string;
  companyName: string;
  legalName: string | null;
  supplierType: SupplierType;
  countryCode: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  website: string | null;
  taxId: string | null;
  defaultCurrency: string;
  paymentTerm: Ref | null;
  productionLeadTimeDays: number | null;
  defaultIncoterm: string | null;
  defaultLoadingPort: Ref | null;
  status: SupplierStatus;
  notes: string | null;
  contacts: ContactDto[];
  addresses: AddressDto[];
  /** Null without supplier_bank.view. */
  bankAccounts: BankAccountDto[] | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  version: number;
}

// ───────────── Catalog ─────────────

export interface AttributeDefinitionDto {
  id: string;
  code: string;
  label: string;
  dataType: AttributeDataType;
  unit: string | null;
  enumOptions: EnumOption[] | null;
  trueLabel: string | null;
  falseLabel: string | null;
  minValue: DecimalString | null;
  maxValue: DecimalString | null;
  description: string | null;
  isActive: boolean;
}

export interface CategoryAttributeDto {
  attribute: AttributeDefinitionDto;
  isRequired: boolean;
  isVariantDefining: boolean;
  sortOrder: number;
  /** Category the rule is inherited from (a parent), when not defined on this category itself. */
  inheritedFrom: string | null;
}

export interface CategoryDto {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  path: string;
  attributes: CategoryAttributeDto[];
  productCount: number;
}

export type SpecValues = Record<string, string | number | boolean>;

export interface ProductListItemDto {
  id: string;
  code: string;
  name: string;
  category: Ref;
  categoryPath: string;
  defaultSalesUom: string;
  hsCode: string | null;
  countryOfOrigin: string | null;
  isActive: boolean;
  variantCount: number;
}

export interface VariantDto {
  id: string;
  sku: string;
  displayName: string;
  attributes: SpecValues;
  isActive: boolean;
  createdAt: Timestamp;
}

export interface ProductDto {
  id: string;
  code: string;
  name: string;
  category: Ref;
  categoryPath: string;
  description: string | null;
  baseUom: string;
  defaultSalesUom: string;
  defaultPurchaseUom: string;
  hsCode: string | null;
  countryOfOrigin: string | null;
  defaultPurchaseCurrency: string | null;
  defaultSalesCurrency: string | null;
  defaultPackagingType: Ref | null;
  isActive: boolean;
  notes: string | null;
  fixedAttributes: SpecValues;
  /** Effective rules for this product's category (including inherited ones). */
  specification: CategoryAttributeDto[];
  variants: VariantDto[];
  version: number;
}

// ───────────── Documents ─────────────

export interface DocumentLineDto {
  id: string;
  lineNo: number;
  productId: string;
  productCode: string;
  variantId: string;
  sku: string;
  description: string;
  attributes: SpecValues;
  packagingType: Ref | null;
  qty: DecimalString;
  uom: string;
  qtyBase: DecimalString;
  unitPrice: DecimalString | null;
  discountPct: DecimalString;
  lineTotal: DecimalString | null;
  notes: string | null;
}

export interface ScheduleItemDto {
  seq: number;
  percent: DecimalString;
  amount: DecimalString;
  triggerEvent: TriggerEvent;
  offsetDays: number;
  instrument: PaymentInstrument | null;
  dueDate: DateString | null;
  estimatedDueDate: DateString | null;
  dueStatus: 'FIXED' | 'PENDING_EVENT';
}

export interface QuotationListItemDto {
  id: string;
  number: string;
  revision: number;
  customer: Ref;
  quotationDate: DateString;
  validUntil: DateString;
  currency: string;
  grandTotal: DecimalString;
  status: QuotationStatus;
  salesperson: string | null;
  isExpired: boolean;
}

export interface QuotationLineDto extends DocumentLineDto {
  estUnitCost: DecimalString | null;
  estCostCurrency: string | null;
  /** Estimated margin % (null without finance.view_costs or without cost). */
  estMarginPct: DecimalString | null;
}

export interface QuotationDto {
  id: string;
  number: string;
  revision: number;
  customer: Ref;
  salesperson: Ref | null;
  quotationDate: DateString;
  validUntil: DateString;
  currency: string;
  incoterm: string | null;
  loadingPort: Ref | null;
  destinationCountry: string | null;
  destinationPort: Ref | null;
  paymentTerm: Ref | null;
  paymentTermSummary: string | null;
  estimatedShipmentDate: DateString | null;
  status: QuotationStatus;
  notes: string | null;
  internalNotes: string | null;
  subtotal: DecimalString;
  discountTotal: DecimalString;
  grandTotal: DecimalString;
  lines: QuotationLineDto[];
  revisions: {
    id: string;
    revision: number;
    status: QuotationStatus;
    quotationDate: DateString;
    grandTotal: DecimalString;
  }[];
  salesOrders: Ref[];
  sentAt: Timestamp | null;
  decidedAt: Timestamp | null;
  decisionNote: string | null;
  isExpired: boolean;
  createdAt: Timestamp;
  version: number;
}

export interface SalesOrderListItemDto {
  id: string;
  number: string;
  customer: Ref;
  customerCountry: string;
  customerPoRef: string | null;
  orderDate: DateString;
  currency: string;
  grandTotal: DecimalString;
  grandTotalBase: DecimalString;
  status: SalesOrderStatus;
  displayStatus: SoDisplayStatus;
  purchasedPct: DecimalString;
  shippedPct: DecimalString;
  salesperson: string | null;
  destinationCountry: string | null;
  requestedShipmentDate: DateString | null;
}

export interface AllocationDto {
  id: string;
  salesOrderLineId: string;
  purchaseOrderLineId: string;
  salesOrder: Ref;
  purchaseOrder: Ref;
  customer: Ref;
  supplier: Ref;
  poStatus: PurchaseOrderStatus;
  soLineNo: number;
  poLineNo: number;
  description: string;
  qtyBase: DecimalString;
  isSubstitute: boolean;
  substituteNote: string | null;
  /** PO unit price per base unit, null without finance.view_costs. */
  unitCostBase: DecimalString | null;
  poCurrency: string;
  createdAt: Timestamp;
}

export interface SalesOrderLineDto extends DocumentLineDto {
  tolerancePct: DecimalString;
  lineStatus: OrderLineStatus;
  closedReason: string | null;
  purchasedQtyBase: DecimalString;
  purchasedCommittedQtyBase: DecimalString;
  remainingToPurchaseBase: DecimalString;
  shippedQtyBase: DecimalString;
  remainingToShipBase: DecimalString;
  allocations: AllocationDto[];
}

export interface CreditCheckDto {
  id: string;
  evaluatedAt: Timestamp;
  evaluatedBy: Ref | null;
  currency: string;
  creditLimit: DecimalString;
  openAr: DecimalString;
  overdueAmount: DecimalString;
  openOrders: DecimalString;
  unappliedCredit: DecimalString;
  exposure: DecimalString;
  newOrderValue: DecimalString;
  newOrderUnsecured: DecimalString;
  availableAfter: DecimalString;
  excess: DecimalString;
  result: CreditResult;
  reasons: string[];
  override: { approvedBy: Ref; approvedAt: Timestamp; reason: string } | null;
}

export interface OrderFinanceSummaryDto {
  currency: string;
  salesValue: DecimalString;
  salesValueBase: DecimalString;
  baseCurrency: string;
  /** Committed purchase cost of allocated quantities, in base currency (finance.view_costs). */
  purchaseCostBase: DecimalString | null;
  /** Sales value of purchased quantities minus their cost, base currency. */
  estimatedGrossProfitBase: DecimalString | null;
  estimatedMarginPct: DecimalString | null;
  /** Share of ordered quantity already covered by purchases, percent. */
  costCoveragePct: DecimalString;
}

export interface SalesOrderDto {
  id: string;
  number: string;
  customer: Ref;
  customerStatus: CustomerStatus;
  quotation: Ref | null;
  customerPoRef: string | null;
  orderDate: DateString;
  salesperson: Ref | null;
  currency: string;
  fxRate: DecimalString;
  incoterm: string | null;
  loadingPort: Ref | null;
  destinationCountry: string | null;
  destinationPort: Ref | null;
  shippingAddress: AddressDto | null;
  billingAddress: AddressDto | null;
  paymentTerm: Ref | null;
  paymentTermSummary: string | null;
  requestedShipmentDate: DateString | null;
  status: SalesOrderStatus;
  displayStatus: SoDisplayStatus;
  purchasing: DimensionStatus;
  shipping: DimensionStatus;
  purchasedPct: DecimalString;
  shippedPct: DecimalString;
  confirmedAt: Timestamp | null;
  cancelledAt: Timestamp | null;
  cancelReason: string | null;
  notes: string | null;
  internalNotes: string | null;
  subtotal: DecimalString;
  discountTotal: DecimalString;
  grandTotal: DecimalString;
  grandTotalBase: DecimalString;
  lines: SalesOrderLineDto[];
  paymentSchedule: ScheduleItemDto[];
  creditChecks: CreditCheckDto[];
  finance: OrderFinanceSummaryDto;
  purchaseOrders: (Ref & {
    supplier: Ref;
    status: PurchaseOrderStatus;
    expectedReadyDate: DateString | null;
  })[];
  timeline: ActivityEventDto[];
  createdAt: Timestamp;
  version: number;
}

/** Result of a credit check preview (before confirming). */
export interface CreditPreviewDto {
  result: CreditResult;
  reasons: string[];
  currency: string;
  creditLimit: DecimalString;
  exposure: DecimalString;
  availableBefore: DecimalString;
  newOrderValue: DecimalString;
  newOrderUnsecured: DecimalString;
  availableAfter: DecimalString;
  excess: DecimalString;
  canOverride: boolean;
}

export interface PurchaseOrderListItemDto {
  id: string;
  number: string;
  supplier: Ref;
  supplierCountry: string;
  supplierRef: string | null;
  poDate: DateString;
  currency: string;
  grandTotal: DecimalString | null;
  grandTotalBase: DecimalString | null;
  status: PurchaseOrderStatus;
  expectedReadyDate: DateString | null;
  isDelayed: boolean;
  allocatedPct: DecimalString;
  salesOrders: Ref[];
  buyer: string | null;
}

export interface PurchaseOrderLineDto extends DocumentLineDto {
  expectedReadyDate: DateString | null;
  lineStatus: OrderLineStatus;
  allocatedQtyBase: DecimalString;
  unallocatedQtyBase: DecimalString;
  allocations: AllocationDto[];
}

export interface MilestoneDto {
  milestone: PoMilestone;
  plannedDate: DateString | null;
  actualDate: DateString | null;
  notes: string | null;
}

export interface PurchaseOrderDto {
  id: string;
  number: string;
  supplier: Ref;
  supplierRef: string | null;
  poDate: DateString;
  buyer: Ref | null;
  currency: string;
  fxRate: DecimalString;
  incoterm: string | null;
  loadingPort: Ref | null;
  destinationPort: Ref | null;
  paymentTerm: Ref | null;
  paymentTermSummary: string | null;
  expectedReadyDate: DateString | null;
  confirmedReadyDate: DateString | null;
  isDelayed: boolean;
  status: PurchaseOrderStatus;
  allowedTransitions: PurchaseOrderStatus[];
  sentAt: Timestamp | null;
  confirmedAt: Timestamp | null;
  cancelledAt: Timestamp | null;
  cancelReason: string | null;
  notes: string | null;
  internalNotes: string | null;
  subtotal: DecimalString | null;
  discountTotal: DecimalString | null;
  grandTotal: DecimalString | null;
  grandTotalBase: DecimalString | null;
  lines: PurchaseOrderLineDto[];
  paymentSchedule: ScheduleItemDto[] | null;
  milestones: MilestoneDto[];
  salesOrders: (Ref & { customer: Ref })[];
  timeline: ActivityEventDto[];
  createdAt: Timestamp;
  version: number;
}

export interface AwaitingPurchaseItemDto {
  salesOrderLineId: string;
  salesOrder: Ref;
  customer: Ref;
  orderDate: DateString;
  requestedShipmentDate: DateString | null;
  lineNo: number;
  productId: string;
  variantId: string;
  description: string;
  uom: string;
  orderedQtyBase: DecimalString;
  purchasedQtyBase: DecimalString;
  remainingQtyBase: DecimalString;
  unitPrice: DecimalString;
  currency: string;
  daysSinceConfirmation: number;
}

export interface SearchResultDto {
  type: 'customer' | 'supplier' | 'product' | 'quotation' | 'sales_order' | 'purchase_order' | 'contact';
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

export interface DashboardDto {
  baseCurrency: string;
  openSalesOrders: { count: number; valueBase: DecimalString };
  pendingConfirmation: { count: number; valueBase: DecimalString };
  awaitingPurchase: { lines: number; orders: number };
  openPurchaseOrders: { count: number; valueBase: DecimalString | null };
  delayedPurchaseOrders: number;
  salesThisMonthBase: DecimalString;
  salesThisYearBase: DecimalString;
  purchasesThisMonthBase: DecimalString | null;
  purchasesThisYearBase: DecimalString | null;
  quotationsOpen: number;
  quotationsExpiringSoon: number;
  bankAccountsPendingApproval: number;
  salesByMonth: { month: string; valueBase: DecimalString }[];
  topCustomers: { customer: Ref; valueBase: DecimalString }[];
}
