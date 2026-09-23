/** Status vocabularies shared by the database, API and UI. */

export const CUSTOMER_STATUSES = ['PROSPECT', 'ACTIVE', 'ON_HOLD', 'BLOCKED', 'INACTIVE'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const SUPPLIER_STATUSES = ['ACTIVE', 'ON_HOLD', 'INACTIVE'] as const;
export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number];

export const SUPPLIER_TYPES = [
  'MATERIAL',
  'FORWARDER',
  'SHIPPING_LINE',
  'CUSTOMS_BROKER',
  'INSURER',
  'INSPECTION',
  'AGENT',
  'OTHER',
] as const;
export type SupplierType = (typeof SUPPLIER_TYPES)[number];

export const BANK_ACCOUNT_STATUSES = ['PENDING_APPROVAL', 'APPROVED', 'REVOKED'] as const;
export type BankAccountStatus = (typeof BANK_ACCOUNT_STATUSES)[number];

export const ADDRESS_TYPES = ['BILLING', 'SHIPPING', 'NOTIFY'] as const;
export type AddressType = (typeof ADDRESS_TYPES)[number];

export const QUOTATION_STATUSES = [
  'DRAFT',
  'SENT',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'SUPERSEDED',
  'CONVERTED',
] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

/** Stored, manually driven status of a sales order. Fulfilment progress is derived, not stored. */
export const SALES_ORDER_STATUSES = [
  'DRAFT',
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'ON_HOLD',
  'CLOSED',
  'CANCELLED',
] as const;
export type SalesOrderStatus = (typeof SALES_ORDER_STATUSES)[number];

export const ORDER_LINE_STATUSES = ['OPEN', 'CLOSED_SHORT', 'CANCELLED'] as const;
export type OrderLineStatus = (typeof ORDER_LINE_STATUSES)[number];

export const PURCHASE_ORDER_STATUSES = [
  'DRAFT',
  'SENT',
  'CONFIRMED',
  'IN_PRODUCTION',
  'READY',
  'CLOSED',
  'CANCELLED',
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

/** PO statuses in which the supplier has committed to the goods. */
export const COMMITTED_PO_STATUSES: readonly PurchaseOrderStatus[] = [
  'CONFIRMED',
  'IN_PRODUCTION',
  'READY',
  'CLOSED',
];

/** Allowed manual PO transitions. */
export const PO_TRANSITIONS: Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]> = {
  DRAFT: ['SENT', 'CONFIRMED', 'CANCELLED'],
  SENT: ['CONFIRMED', 'DRAFT', 'CANCELLED'],
  CONFIRMED: ['IN_PRODUCTION', 'READY', 'CANCELLED'],
  IN_PRODUCTION: ['READY', 'CANCELLED'],
  READY: ['CLOSED', 'IN_PRODUCTION'],
  CLOSED: [],
  CANCELLED: [],
};

export const PO_MILESTONES = ['PRODUCTION_STARTED', 'PRODUCTION_DONE', 'INSPECTION', 'READY'] as const;
export type PoMilestone = (typeof PO_MILESTONES)[number];

export const INCOTERM_CODES = [
  'EXW',
  'FCA',
  'CPT',
  'CIP',
  'DAP',
  'DPU',
  'DDP',
  'FAS',
  'FOB',
  'CFR',
  'CIF',
] as const;
export type IncotermCode = (typeof INCOTERM_CODES)[number];

export const ATTRIBUTE_DATA_TYPES = ['NUMBER', 'TEXT', 'BOOLEAN', 'ENUM'] as const;
export type AttributeDataType = (typeof ATTRIBUTE_DATA_TYPES)[number];
