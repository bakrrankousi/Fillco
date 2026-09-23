import { z } from 'zod';
import {
  ADDRESS_TYPES,
  ATTRIBUTE_DATA_TYPES,
  CUSTOMER_STATUSES,
  PAYMENT_INSTRUMENTS,
  PO_MILESTONES,
  PURCHASE_ORDER_STATUSES,
  SUPPLIER_STATUSES,
  SUPPLIER_TYPES,
  TRIGGER_EVENTS,
} from '@fillco/domain';
import {
  countryCode,
  currencyCode,
  decimalString,
  email,
  fxRate,
  isoDate,
  money,
  optionalDate,
  optionalEmail,
  optionalText,
  optionalUuid,
  percent,
  quantity,
  requiredText,
  uuid,
  versioned,
} from './common';
import { ROLE_CODES } from './permissions';

// ───────────── Auth & users ─────────────

export const passwordSchema = z
  .string()
  .min(10, 'At least 10 characters')
  .max(200)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Use letters and numbers');

export const loginSchema = z.object({ email, password: z.string().min(1).max(200) });
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const createUserSchema = z.object({
  email,
  fullName: requiredText(),
  phone: optionalText(50),
  password: passwordSchema,
  roleCodes: z.array(z.enum(ROLE_CODES)).min(1, 'Assign at least one role'),
  isActive: z.boolean().default(true),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  fullName: requiredText().optional(),
  phone: optionalText(50),
  roleCodes: z.array(z.enum(ROLE_CODES)).min(1).optional(),
  isActive: z.boolean().optional(),
  ...versioned,
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const resetPasswordSchema = z.object({ newPassword: passwordSchema });

// ───────────── Company & master data ─────────────

export const updateCompanySchema = z.object({
  name: requiredText().optional(),
  legalName: optionalText(),
  taxId: optionalText(100),
  address: optionalText(),
  city: optionalText(100),
  countryCode: countryCode.nullish(),
  phone: optionalText(50),
  email: optionalEmail,
  website: optionalText(200),
  baseCurrency: currencyCode.optional(),
  timezone: z.string().min(3).max(64).optional(),
  blockOverdueDays: z.number().int().min(0).max(3650).optional(),
  defaultTolerancePct: percent.optional(),
  invoiceFooter: optionalText(2000),
  ...versioned,
});
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

export const exchangeRateSchema = z
  .object({
    rateDate: isoDate,
    fromCurrency: currencyCode,
    toCurrency: currencyCode,
    rate: fxRate,
  })
  .refine((v) => v.fromCurrency !== v.toCurrency, { message: 'Currencies must differ', path: ['toCurrency'] });
export type ExchangeRateInput = z.infer<typeof exchangeRateSchema>;

export const currencySchema = z.object({
  code: currencyCode,
  name: requiredText(100),
  symbol: optionalText(10),
  minorUnits: z.number().int().min(0).max(4).default(2),
  isActive: z.boolean().default(true),
});
export type CurrencyInput = z.infer<typeof currencySchema>;

export const portSchema = z.object({
  locode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}[A-Z0-9]{3}$/, 'UN/LOCODE is 5 characters, e.g. TRMER'),
  name: requiredText(100),
  countryCode,
  type: z.enum(['SEA', 'AIR', 'LAND', 'INLAND']).default('SEA'),
  isActive: z.boolean().default(true),
});
export type PortInput = z.infer<typeof portSchema>;

export const installmentSchema = z.object({
  percent: decimalString({ maxDecimals: 4 }),
  triggerEvent: z.enum(TRIGGER_EVENTS),
  offsetDays: z.number().int().min(-365).max(730),
  instrument: z.enum(PAYMENT_INSTRUMENTS).nullish(),
});
export type InstallmentInput = z.infer<typeof installmentSchema>;

export const paymentTermSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{2,30}$/, 'Letters, digits, - and _ only'),
  name: requiredText(100),
  description: optionalText(),
  isActive: z.boolean().default(true),
  installments: z.array(installmentSchema).min(1).max(12),
});
export type PaymentTermInput = z.infer<typeof paymentTermSchema>;

// ───────────── Parties ─────────────

const contactFields = {
  name: requiredText(),
  position: optionalText(100),
  phone: optionalText(50),
  email: optionalEmail,
  whatsapp: optionalText(50),
  isPrimary: z.boolean().default(false),
  notes: optionalText(1000),
};
export const contactSchema = z.object(contactFields);
export type ContactInput = z.infer<typeof contactSchema>;

export const addressSchema = z.object({
  type: z.enum(ADDRESS_TYPES),
  label: optionalText(100),
  line1: requiredText(300),
  line2: optionalText(300),
  city: optionalText(100),
  state: optionalText(100),
  postalCode: optionalText(20),
  countryCode,
  isDefault: z.boolean().default(false),
});
export type AddressInput = z.infer<typeof addressSchema>;

const partyCommon = {
  companyName: requiredText(),
  legalName: optionalText(),
  countryCode,
  city: optionalText(100),
  address: optionalText(),
  phone: optionalText(50),
  email: optionalEmail,
  whatsapp: optionalText(50),
  website: optionalText(200),
  taxId: optionalText(100),
  defaultCurrency: currencyCode,
  paymentTermId: optionalUuid,
  defaultIncoterm: optionalText(3),
  notes: optionalText(5000),
};

export const createCustomerSchema = z.object({
  ...partyCommon,
  vatNumber: optionalText(100),
  creditLimit: money.default('0'),
  creditLimitCurrency: currencyCode.optional(),
  defaultDestinationPortId: optionalUuid,
  salespersonId: optionalUuid,
  status: z.enum(CUSTOMER_STATUSES).default('ACTIVE'),
  contacts: z.array(contactSchema).max(20).default([]),
  addresses: z.array(addressSchema).max(20).default([]),
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = createCustomerSchema
  .omit({ contacts: true, addresses: true })
  .partial()
  .extend(versioned);
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export const createSupplierSchema = z.object({
  ...partyCommon,
  supplierType: z.enum(SUPPLIER_TYPES).default('MATERIAL'),
  productionLeadTimeDays: z.number().int().min(0).max(365).nullish(),
  defaultLoadingPortId: optionalUuid,
  status: z.enum(SUPPLIER_STATUSES).default('ACTIVE'),
  contacts: z.array(contactSchema).max(20).default([]),
  addresses: z.array(addressSchema).max(20).default([]),
});
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;

export const updateSupplierSchema = createSupplierSchema
  .omit({ contacts: true, addresses: true })
  .partial()
  .extend(versioned);
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

export const bankAccountSchema = z
  .object({
    bankName: requiredText(),
    accountName: requiredText(),
    accountNumber: optionalText(50),
    iban: z
      .string()
      .transform((v) => v.replace(/\s/g, '').toUpperCase())
      .refine((v) => v === '' || /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v), 'Invalid IBAN format')
      .nullish()
      .transform((v) => (v ? v : null)),
    swift: z
      .string()
      .transform((v) => v.replace(/\s/g, '').toUpperCase())
      .refine((v) => v === '' || /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(v), 'Invalid SWIFT/BIC')
      .nullish()
      .transform((v) => (v ? v : null)),
    currency: currencyCode,
    bankAddress: optionalText(),
    notes: optionalText(1000),
  })
  .refine((v) => v.iban || v.accountNumber, { message: 'Enter an IBAN or an account number', path: ['iban'] });
export type BankAccountInput = z.infer<typeof bankAccountSchema>;

// ───────────── Catalog ─────────────

export const categorySchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{2,30}$/),
  name: requiredText(100),
  parentId: optionalUuid,
  sortOrder: z.number().int().default(0),
});
export type CategoryInput = z.infer<typeof categorySchema>;

export const attributeDefinitionSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z][a-z0-9_]{1,40}$/, 'lower_snake_case'),
    label: requiredText(100),
    dataType: z.enum(ATTRIBUTE_DATA_TYPES),
    unit: optionalText(10),
    enumOptions: z
      .array(z.object({ value: z.string().trim().min(1).max(60), label: z.string().trim().min(1).max(100) }))
      .max(100)
      .nullish(),
    trueLabel: optionalText(60),
    falseLabel: optionalText(60),
    minValue: decimalString({ allowNegative: true }).nullish(),
    maxValue: decimalString({ allowNegative: true }).nullish(),
    description: optionalText(),
  })
  .refine((v) => v.dataType !== 'ENUM' || (v.enumOptions && v.enumOptions.length > 0), {
    message: 'ENUM attributes need options',
    path: ['enumOptions'],
  });
export type AttributeDefinitionInput = z.infer<typeof attributeDefinitionSchema>;

export const categoryAttributesSchema = z.object({
  attributes: z
    .array(
      z.object({
        attributeId: uuid,
        isRequired: z.boolean().default(false),
        isVariantDefining: z.boolean().default(true),
        sortOrder: z.number().int().default(0),
      }),
    )
    .max(50),
});
export type CategoryAttributesInput = z.infer<typeof categoryAttributesSchema>;

const specValue = z.union([z.string(), z.number(), z.boolean()]);
export const specInput = z.record(z.string(), specValue.nullish());

export const productSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9._-]{2,40}$/, 'Letters, digits, . - _'),
  name: requiredText(),
  categoryId: uuid,
  description: optionalText(2000),
  defaultSalesUom: z.string().default('MT'),
  defaultPurchaseUom: z.string().default('MT'),
  hsCode: optionalText(20),
  countryOfOrigin: countryCode.nullish(),
  defaultPurchaseCurrency: currencyCode.nullish(),
  defaultSalesCurrency: currencyCode.nullish(),
  defaultPackagingTypeId: optionalUuid,
  isActive: z.boolean().default(true),
  notes: optionalText(5000),
  /** Specification values fixed for every variant of this product. */
  fixedAttributes: specInput.default({}),
});
export type ProductInput = z.infer<typeof productSchema>;
export const updateProductSchema = productSchema.partial().extend(versioned);
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const resolveVariantSchema = z.object({ productId: uuid, attributes: specInput });
export type ResolveVariantInput = z.infer<typeof resolveVariantSchema>;

// ───────────── Document lines ─────────────

export const documentLineSchema = z.object({
  /** Existing line id when editing; omitted for new lines. */
  id: uuid.optional(),
  productId: uuid,
  attributes: specInput.default({}),
  description: optionalText(500),
  packagingTypeId: optionalUuid,
  qty: quantity.refine((v) => Number(v) > 0, 'Quantity must be > 0'),
  uom: z.string().min(1).max(10),
  unitPrice: money,
  discountPct: percent.default('0'),
  notes: optionalText(1000),
});
export type DocumentLineInput = z.infer<typeof documentLineSchema>;

// ───────────── Quotations ─────────────

export const quotationSchema = z.object({
  customerId: uuid,
  salespersonId: optionalUuid,
  quotationDate: isoDate,
  validUntil: isoDate,
  currency: currencyCode,
  incoterm: optionalText(3),
  loadingPortId: optionalUuid,
  destinationCountry: countryCode.nullish(),
  destinationPortId: optionalUuid,
  paymentTermId: optionalUuid,
  estimatedShipmentDate: optionalDate,
  notes: optionalText(5000),
  internalNotes: optionalText(5000),
  lines: z
    .array(
      documentLineSchema.extend({
        estUnitCost: money.nullish(),
        estCostCurrency: currencyCode.nullish(),
      }),
    )
    .min(1, 'Add at least one line')
    .max(100),
});
export type QuotationInput = z.infer<typeof quotationSchema>;
export const updateQuotationSchema = quotationSchema.extend(versioned);
export type UpdateQuotationInput = z.infer<typeof updateQuotationSchema>;

export const quotationDecisionSchema = z.object({ note: optionalText(1000) });

// ───────────── Sales orders ─────────────

export const salesOrderSchema = z.object({
  customerId: uuid,
  customerPoRef: optionalText(100),
  orderDate: isoDate,
  salespersonId: optionalUuid,
  currency: currencyCode,
  incoterm: optionalText(3),
  loadingPortId: optionalUuid,
  destinationCountry: countryCode.nullish(),
  destinationPortId: optionalUuid,
  shippingAddressId: optionalUuid,
  billingAddressId: optionalUuid,
  paymentTermId: optionalUuid,
  requestedShipmentDate: optionalDate,
  notes: optionalText(5000),
  internalNotes: optionalText(5000),
  lines: z
    .array(documentLineSchema.extend({ tolerancePct: percent.optional() }))
    .min(1, 'Add at least one line')
    .max(100),
});
export type SalesOrderInput = z.infer<typeof salesOrderSchema>;
export const updateSalesOrderSchema = salesOrderSchema.extend(versioned);
export type UpdateSalesOrderInput = z.infer<typeof updateSalesOrderSchema>;

export const confirmSalesOrderSchema = z.object({
  /** Required when the credit check does not pass; needs credit.override. */
  overrideReason: optionalText(1000),
  ...versioned,
});
export type ConfirmSalesOrderInput = z.infer<typeof confirmSalesOrderSchema>;

// ───────────── Purchase orders ─────────────

export const purchaseOrderSchema = z.object({
  supplierId: uuid,
  supplierRef: optionalText(100),
  poDate: isoDate,
  buyerId: optionalUuid,
  currency: currencyCode,
  incoterm: optionalText(3),
  loadingPortId: optionalUuid,
  destinationPortId: optionalUuid,
  paymentTermId: optionalUuid,
  expectedReadyDate: optionalDate,
  notes: optionalText(5000),
  internalNotes: optionalText(5000),
  lines: z
    .array(documentLineSchema.extend({ expectedReadyDate: optionalDate }))
    .min(1, 'Add at least one line')
    .max(100),
});
export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>;
export const updatePurchaseOrderSchema = purchaseOrderSchema.extend(versioned);
export type UpdatePurchaseOrderInput = z.infer<typeof updatePurchaseOrderSchema>;

export const purchaseOrderTransitionSchema = z.object({
  to: z.enum(PURCHASE_ORDER_STATUSES),
  reason: optionalText(1000),
  confirmedReadyDate: optionalDate,
  supplierRef: optionalText(100),
  ...versioned,
});
export type PurchaseOrderTransitionInput = z.infer<typeof purchaseOrderTransitionSchema>;

export const milestoneSchema = z.object({
  milestone: z.enum(PO_MILESTONES),
  plannedDate: optionalDate,
  actualDate: optionalDate,
  notes: optionalText(1000),
});
export type MilestoneInput = z.infer<typeof milestoneSchema>;

/** Create a PO directly from open sales order lines (back-to-back purchasing). */
export const purchaseFromSalesSchema = z.object({
  supplierId: uuid,
  poDate: isoDate,
  currency: currencyCode,
  incoterm: optionalText(3),
  loadingPortId: optionalUuid,
  paymentTermId: optionalUuid,
  expectedReadyDate: optionalDate,
  supplierRef: optionalText(100),
  notes: optionalText(5000),
  lines: z
    .array(
      z.object({
        salesOrderLineId: uuid,
        qty: quantity.refine((v) => Number(v) > 0, 'Quantity must be > 0'),
        uom: z.string().min(1).max(10),
        unitPrice: money,
      }),
    )
    .min(1)
    .max(100),
});
export type PurchaseFromSalesInput = z.infer<typeof purchaseFromSalesSchema>;

export const allocationSchema = z.object({
  salesOrderLineId: uuid,
  purchaseOrderLineId: uuid,
  qty: quantity.refine((v) => Number(v) > 0, 'Quantity must be > 0'),
  uom: z.string().min(1).max(10),
  /** Required when the PO line specification differs from the SO line. */
  substituteNote: optionalText(1000),
});
export type AllocationInput = z.infer<typeof allocationSchema>;

export const closeLineSchema = z.object({ reason: requiredText(1000) });

