-- Trigram matching for global search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('PROSPECT', 'ACTIVE', 'ON_HOLD', 'BLOCKED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('ACTIVE', 'ON_HOLD', 'INACTIVE');

-- CreateEnum
CREATE TYPE "SupplierType" AS ENUM ('MATERIAL', 'FORWARDER', 'SHIPPING_LINE', 'CUSTOMS_BROKER', 'INSURER', 'INSPECTION', 'AGENT', 'OTHER');

-- CreateEnum
CREATE TYPE "BankAccountStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AddressType" AS ENUM ('BILLING', 'SHIPPING', 'NOTIFY');

-- CreateEnum
CREATE TYPE "PortType" AS ENUM ('SEA', 'AIR', 'LAND', 'INLAND');

-- CreateEnum
CREATE TYPE "TriggerEvent" AS ENUM ('ORDER_CONFIRMATION', 'BEFORE_LOADING', 'INVOICE_DATE', 'BL_DATE', 'ETA', 'ARRIVAL', 'DELIVERY');

-- CreateEnum
CREATE TYPE "PaymentInstrument" AS ENUM ('TT', 'CAD', 'LC', 'CASH', 'CHEQUE');

-- CreateEnum
CREATE TYPE "DueStatus" AS ENUM ('FIXED', 'PENDING_EVENT');

-- CreateEnum
CREATE TYPE "AttributeDataType" AS ENUM ('NUMBER', 'TEXT', 'BOOLEAN', 'ENUM');

-- CreateEnum
CREATE TYPE "UomDimension" AS ENUM ('MASS', 'COUNT', 'LENGTH');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'SUPERSEDED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT', 'PENDING_CONFIRMATION', 'CONFIRMED', 'ON_HOLD', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderLineStatus" AS ENUM ('OPEN', 'CLOSED_SHORT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'SENT', 'CONFIRMED', 'IN_PRODUCTION', 'READY', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PoMilestone" AS ENUM ('PRODUCTION_STARTED', 'PRODUCTION_DONE', 'INSPECTION', 'READY');

-- CreateEnum
CREATE TYPE "CreditResult" AS ENUM ('PASS', 'WARN', 'BLOCK');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "tax_id" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country_code" CHAR(2),
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "base_currency" CHAR(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul',
    "block_overdue_days" INTEGER NOT NULL DEFAULT 30,
    "default_tolerance_pct" DECIMAL(9,4) NOT NULL DEFAULT 5,
    "invoice_footer" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "csrf_token" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_sequences" (
    "company_id" UUID NOT NULL,
    "doc_type" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "prefix" TEXT NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("company_id","doc_type","year")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changes" JSONB,
    "reason" TEXT,
    "request_id" TEXT,
    "ip" TEXT,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_events" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "event_type" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "customer_id" UUID,
    "supplier_id" UUID,
    "quotation_id" UUID,
    "sales_order_id" UUID,
    "purchase_order_id" UUID,
    "summary" TEXT NOT NULL,
    "payload" JSONB,
    "user_id" UUID,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_references" (
    "id" UUID NOT NULL,
    "system" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currencies" (
    "code" CHAR(3) NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT,
    "minor_units" INTEGER NOT NULL DEFAULT 2,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" UUID NOT NULL,
    "rate_date" DATE NOT NULL,
    "from_currency" CHAR(3) NOT NULL,
    "to_currency" CHAR(3) NOT NULL,
    "rate" DECIMAL(20,10) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "countries" (
    "code" CHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ports" (
    "id" UUID NOT NULL,
    "locode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "type" "PortType" NOT NULL DEFAULT 'SEA',
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incoterms" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "seller_pays_main_carriage" BOOLEAN NOT NULL,
    "seller_pays_insurance" BOOLEAN NOT NULL,
    "sea_only" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "incoterms_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "payment_terms" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "payment_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_term_installments" (
    "id" UUID NOT NULL,
    "payment_term_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "percent" DECIMAL(9,4) NOT NULL,
    "trigger_event" "TriggerEvent" NOT NULL,
    "offset_days" INTEGER NOT NULL,
    "instrument" "PaymentInstrument",

    CONSTRAINT "payment_term_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "legal_name" TEXT,
    "country_code" CHAR(2) NOT NULL,
    "city" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "whatsapp" TEXT,
    "website" TEXT,
    "tax_id" TEXT,
    "vat_number" TEXT,
    "default_currency" CHAR(3) NOT NULL,
    "payment_term_id" UUID,
    "credit_limit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "credit_limit_currency" CHAR(3) NOT NULL,
    "default_incoterm" TEXT,
    "default_destination_port_id" UUID,
    "salesperson_id" UUID,
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_contacts" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "whatsapp" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_addresses" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "type" "AddressType" NOT NULL,
    "label" TEXT,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postal_code" TEXT,
    "country_code" CHAR(2) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "legal_name" TEXT,
    "supplier_type" "SupplierType" NOT NULL DEFAULT 'MATERIAL',
    "country_code" CHAR(2) NOT NULL,
    "city" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "whatsapp" TEXT,
    "website" TEXT,
    "tax_id" TEXT,
    "default_currency" CHAR(3) NOT NULL,
    "payment_term_id" UUID,
    "production_lead_time_days" INTEGER,
    "default_incoterm" TEXT,
    "default_loading_port_id" UUID,
    "status" "SupplierStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_contacts" (
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "whatsapp" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_addresses" (
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "type" "AddressType" NOT NULL,
    "label" TEXT,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postal_code" TEXT,
    "country_code" CHAR(2) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_bank_accounts" (
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "account_number" TEXT,
    "iban" TEXT,
    "swift" TEXT,
    "currency" CHAR(3) NOT NULL,
    "bank_address" TEXT,
    "status" "BankAccountStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "supplier_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_categories" (
    "id" UUID NOT NULL,
    "parent_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attribute_definitions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "data_type" "AttributeDataType" NOT NULL,
    "unit" TEXT,
    "enum_options" JSONB,
    "true_label" TEXT,
    "false_label" TEXT,
    "min_value" DECIMAL(18,4),
    "max_value" DECIMAL(18,4),
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attribute_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_attributes" (
    "category_id" UUID NOT NULL,
    "attribute_id" UUID NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "is_variant_defining" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "category_attributes_pkey" PRIMARY KEY ("category_id","attribute_id")
);

-- CreateTable
CREATE TABLE "uoms" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dimension" "UomDimension" NOT NULL,
    "factor_to_base" DECIMAL(20,10) NOT NULL,
    "is_base" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "uoms_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "packaging_types" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nominal_weight_kg" DECIMAL(18,4),
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "packaging_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category_id" UUID NOT NULL,
    "description" TEXT,
    "base_uom" TEXT NOT NULL DEFAULT 'KG',
    "default_sales_uom" TEXT NOT NULL DEFAULT 'MT',
    "default_purchase_uom" TEXT NOT NULL DEFAULT 'MT',
    "hs_code" TEXT,
    "country_of_origin" CHAR(2),
    "default_purchase_currency" CHAR(3),
    "default_sales_currency" CHAR(3),
    "default_packaging_type_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_attribute_values" (
    "product_id" UUID NOT NULL,
    "attribute_id" UUID NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "product_attribute_values_pkey" PRIMARY KEY ("product_id","attribute_id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "spec_hash" TEXT NOT NULL,
    "attributes" JSONB NOT NULL,
    "display_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "previous_revision_id" UUID,
    "customer_id" UUID NOT NULL,
    "salesperson_id" UUID,
    "quotation_date" DATE NOT NULL,
    "valid_until" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "incoterm" TEXT,
    "loading_port_id" UUID,
    "destination_country" CHAR(2),
    "destination_port_id" UUID,
    "payment_term_id" UUID,
    "estimated_shipment_date" DATE,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "internal_notes" TEXT,
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount_total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "grand_total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMPTZ(3),
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_lines" (
    "id" UUID NOT NULL,
    "quotation_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "variant_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "spec_snapshot" JSONB NOT NULL,
    "packaging_type_id" UUID,
    "qty" DECIMAL(18,4) NOT NULL,
    "uom" TEXT NOT NULL,
    "qty_base" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "discount_pct" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(18,4) NOT NULL,
    "est_unit_cost" DECIMAL(18,4),
    "est_cost_currency" CHAR(3),
    "notes" TEXT,

    CONSTRAINT "quotation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_orders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "quotation_id" UUID,
    "customer_po_ref" TEXT,
    "order_date" DATE NOT NULL,
    "salesperson_id" UUID,
    "currency" CHAR(3) NOT NULL,
    "fx_rate" DECIMAL(20,10) NOT NULL,
    "incoterm" TEXT,
    "loading_port_id" UUID,
    "destination_country" CHAR(2),
    "destination_port_id" UUID,
    "shipping_address_id" UUID,
    "billing_address_id" UUID,
    "payment_term_id" UUID,
    "requested_shipment_date" DATE,
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "confirmed_at" TIMESTAMPTZ(3),
    "confirmed_by_id" UUID,
    "closed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "notes" TEXT,
    "internal_notes" TEXT,
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount_total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "grand_total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "grand_total_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_lines" (
    "id" UUID NOT NULL,
    "sales_order_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "variant_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "spec_snapshot" JSONB NOT NULL,
    "packaging_type_id" UUID,
    "qty" DECIMAL(18,4) NOT NULL,
    "uom" TEXT NOT NULL,
    "qty_base" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "discount_pct" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(18,4) NOT NULL,
    "tolerance_pct" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "line_status" "OrderLineStatus" NOT NULL DEFAULT 'OPEN',
    "closed_reason" TEXT,
    "notes" TEXT,

    CONSTRAINT "sales_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_payment_schedule" (
    "id" UUID NOT NULL,
    "sales_order_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "percent" DECIMAL(9,4) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "trigger_event" "TriggerEvent" NOT NULL,
    "offset_days" INTEGER NOT NULL,
    "instrument" "PaymentInstrument",
    "due_date" DATE,
    "estimated_due_date" DATE,
    "due_status" "DueStatus" NOT NULL,

    CONSTRAINT "sales_order_payment_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_checks" (
    "id" UUID NOT NULL,
    "sales_order_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "evaluated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evaluated_by_id" UUID,
    "currency" CHAR(3) NOT NULL,
    "credit_limit" DECIMAL(18,4) NOT NULL,
    "open_ar" DECIMAL(18,4) NOT NULL,
    "overdue_amount" DECIMAL(18,4) NOT NULL,
    "open_orders" DECIMAL(18,4) NOT NULL,
    "unapplied_credit" DECIMAL(18,4) NOT NULL,
    "exposure" DECIMAL(18,4) NOT NULL,
    "new_order_value" DECIMAL(18,4) NOT NULL,
    "new_order_unsecured" DECIMAL(18,4) NOT NULL,
    "available_after" DECIMAL(18,4) NOT NULL,
    "excess" DECIMAL(18,4) NOT NULL,
    "result" "CreditResult" NOT NULL,
    "reasons" JSONB NOT NULL,

    CONSTRAINT "credit_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_overrides" (
    "id" UUID NOT NULL,
    "credit_check_id" UUID NOT NULL,
    "approved_by_id" UUID NOT NULL,
    "approved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,

    CONSTRAINT "credit_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "supplier_ref" TEXT,
    "po_date" DATE NOT NULL,
    "buyer_id" UUID,
    "currency" CHAR(3) NOT NULL,
    "fx_rate" DECIMAL(20,10) NOT NULL,
    "incoterm" TEXT,
    "loading_port_id" UUID,
    "destination_port_id" UUID,
    "payment_term_id" UUID,
    "expected_ready_date" DATE,
    "confirmed_ready_date" DATE,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "sent_at" TIMESTAMPTZ(3),
    "confirmed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "notes" TEXT,
    "internal_notes" TEXT,
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount_total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "grand_total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "grand_total_base" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "variant_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "spec_snapshot" JSONB NOT NULL,
    "packaging_type_id" UUID,
    "qty" DECIMAL(18,4) NOT NULL,
    "uom" TEXT NOT NULL,
    "qty_base" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "discount_pct" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(18,4) NOT NULL,
    "expected_ready_date" DATE,
    "line_status" "OrderLineStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_allocations" (
    "id" UUID NOT NULL,
    "sales_order_line_id" UUID NOT NULL,
    "purchase_order_line_id" UUID NOT NULL,
    "qty_base" DECIMAL(18,4) NOT NULL,
    "is_substitute" BOOLEAN NOT NULL DEFAULT false,
    "substitute_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "order_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_payment_schedule" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "percent" DECIMAL(9,4) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "trigger_event" "TriggerEvent" NOT NULL,
    "offset_days" INTEGER NOT NULL,
    "instrument" "PaymentInstrument",
    "due_date" DATE,
    "estimated_due_date" DATE,
    "due_status" "DueStatus" NOT NULL,

    CONSTRAINT "purchase_order_payment_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_milestones" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "milestone" "PoMilestone" NOT NULL,
    "planned_date" DATE,
    "actual_date" DATE,
    "notes" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "purchase_order_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_occurred_at_idx" ON "audit_logs"("occurred_at");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "activity_events_sales_order_id_occurred_at_idx" ON "activity_events"("sales_order_id", "occurred_at");

-- CreateIndex
CREATE INDEX "activity_events_purchase_order_id_occurred_at_idx" ON "activity_events"("purchase_order_id", "occurred_at");

-- CreateIndex
CREATE INDEX "activity_events_customer_id_occurred_at_idx" ON "activity_events"("customer_id", "occurred_at");

-- CreateIndex
CREATE INDEX "activity_events_supplier_id_occurred_at_idx" ON "activity_events"("supplier_id", "occurred_at");

-- CreateIndex
CREATE INDEX "outbox_events_status_available_at_idx" ON "outbox_events"("status", "available_at");

-- CreateIndex
CREATE UNIQUE INDEX "external_references_system_entity_type_entity_id_key" ON "external_references"("system", "entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_references_system_entity_type_external_id_key" ON "external_references"("system", "entity_type", "external_id");

-- CreateIndex
CREATE INDEX "exchange_rates_from_currency_to_currency_rate_date_idx" ON "exchange_rates"("from_currency", "to_currency", "rate_date");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_rate_date_from_currency_to_currency_source_key" ON "exchange_rates"("rate_date", "from_currency", "to_currency", "source");

-- CreateIndex
CREATE UNIQUE INDEX "ports_locode_key" ON "ports"("locode");

-- CreateIndex
CREATE UNIQUE INDEX "payment_terms_code_key" ON "payment_terms"("code");

-- CreateIndex
CREATE UNIQUE INDEX "payment_term_installments_payment_term_id_seq_key" ON "payment_term_installments"("payment_term_id", "seq");

-- CreateIndex
CREATE INDEX "customers_salesperson_id_idx" ON "customers"("salesperson_id");

-- CreateIndex
CREATE INDEX "customers_country_code_idx" ON "customers"("country_code");

-- CreateIndex
CREATE INDEX "customers_company_name_trgm" ON "customers" USING GIN ("company_name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "customers_company_id_code_key" ON "customers"("company_id", "code");

-- CreateIndex
CREATE INDEX "customer_contacts_customer_id_idx" ON "customer_contacts"("customer_id");

-- CreateIndex
CREATE INDEX "customer_addresses_customer_id_idx" ON "customer_addresses"("customer_id");

-- CreateIndex
CREATE INDEX "suppliers_supplier_type_idx" ON "suppliers"("supplier_type");

-- CreateIndex
CREATE INDEX "suppliers_company_name_trgm" ON "suppliers" USING GIN ("company_name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_company_id_code_key" ON "suppliers"("company_id", "code");

-- CreateIndex
CREATE INDEX "supplier_contacts_supplier_id_idx" ON "supplier_contacts"("supplier_id");

-- CreateIndex
CREATE INDEX "supplier_addresses_supplier_id_idx" ON "supplier_addresses"("supplier_id");

-- CreateIndex
CREATE INDEX "supplier_bank_accounts_supplier_id_idx" ON "supplier_bank_accounts"("supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_code_key" ON "product_categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "attribute_definitions_code_key" ON "attribute_definitions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "packaging_types_code_key" ON "packaging_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "products_code_key" ON "products"("code");

-- CreateIndex
CREATE INDEX "products_category_id_idx" ON "products"("category_id");

-- CreateIndex
CREATE INDEX "products_name_trgm" ON "products" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_sku_key" ON "product_variants"("sku");

-- CreateIndex
CREATE INDEX "product_variants_display_name_trgm" ON "product_variants" USING GIN ("display_name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_product_id_spec_hash_key" ON "product_variants"("product_id", "spec_hash");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_previous_revision_id_key" ON "quotations"("previous_revision_id");

-- CreateIndex
CREATE INDEX "quotations_customer_id_idx" ON "quotations"("customer_id");

-- CreateIndex
CREATE INDEX "quotations_status_idx" ON "quotations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_company_id_number_revision_key" ON "quotations"("company_id", "number", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_lines_quotation_id_line_no_key" ON "quotation_lines"("quotation_id", "line_no");

-- CreateIndex
CREATE INDEX "sales_orders_customer_id_idx" ON "sales_orders"("customer_id");

-- CreateIndex
CREATE INDEX "sales_orders_status_idx" ON "sales_orders"("status");

-- CreateIndex
CREATE INDEX "sales_orders_order_date_idx" ON "sales_orders"("order_date");

-- CreateIndex
CREATE INDEX "sales_orders_number_trgm" ON "sales_orders" USING GIN ("number" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_company_id_number_key" ON "sales_orders"("company_id", "number");

-- CreateIndex
CREATE INDEX "sales_order_lines_variant_id_idx" ON "sales_order_lines"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_lines_sales_order_id_line_no_key" ON "sales_order_lines"("sales_order_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_payment_schedule_sales_order_id_seq_key" ON "sales_order_payment_schedule"("sales_order_id", "seq");

-- CreateIndex
CREATE INDEX "credit_checks_sales_order_id_idx" ON "credit_checks"("sales_order_id");

-- CreateIndex
CREATE INDEX "credit_checks_customer_id_idx" ON "credit_checks"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_overrides_credit_check_id_key" ON "credit_overrides"("credit_check_id");

-- CreateIndex
CREATE INDEX "purchase_orders_supplier_id_idx" ON "purchase_orders"("supplier_id");

-- CreateIndex
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders"("status");

-- CreateIndex
CREATE INDEX "purchase_orders_number_trgm" ON "purchase_orders" USING GIN ("number" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_company_id_number_key" ON "purchase_orders"("company_id", "number");

-- CreateIndex
CREATE INDEX "purchase_order_lines_variant_id_idx" ON "purchase_order_lines"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_lines_purchase_order_id_line_no_key" ON "purchase_order_lines"("purchase_order_id", "line_no");

-- CreateIndex
CREATE INDEX "order_allocations_purchase_order_line_id_idx" ON "order_allocations"("purchase_order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_allocations_sales_order_line_id_purchase_order_line_i_key" ON "order_allocations"("sales_order_line_id", "purchase_order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_payment_schedule_purchase_order_id_seq_key" ON "purchase_order_payment_schedule"("purchase_order_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_milestones_purchase_order_id_milestone_key" ON "purchase_order_milestones"("purchase_order_id", "milestone");

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_base_currency_fkey" FOREIGN KEY ("base_currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_from_currency_fkey" FOREIGN KEY ("from_currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_to_currency_fkey" FOREIGN KEY ("to_currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ports" ADD CONSTRAINT "ports_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_term_installments" ADD CONSTRAINT "payment_term_installments_payment_term_id_fkey" FOREIGN KEY ("payment_term_id") REFERENCES "payment_terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_payment_term_id_fkey" FOREIGN KEY ("payment_term_id") REFERENCES "payment_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_salesperson_id_fkey" FOREIGN KEY ("salesperson_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_payment_term_id_fkey" FOREIGN KEY ("payment_term_id") REFERENCES "payment_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_contacts" ADD CONSTRAINT "supplier_contacts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_addresses" ADD CONSTRAINT "supplier_addresses_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bank_accounts" ADD CONSTRAINT "supplier_bank_accounts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bank_accounts" ADD CONSTRAINT "supplier_bank_accounts_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_attributes" ADD CONSTRAINT "category_attributes_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_attributes" ADD CONSTRAINT "category_attributes_attribute_id_fkey" FOREIGN KEY ("attribute_id") REFERENCES "attribute_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_attribute_id_fkey" FOREIGN KEY ("attribute_id") REFERENCES "attribute_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_salesperson_id_fkey" FOREIGN KEY ("salesperson_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_payment_term_id_fkey" FOREIGN KEY ("payment_term_id") REFERENCES "payment_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_previous_revision_id_fkey" FOREIGN KEY ("previous_revision_id") REFERENCES "quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_salesperson_id_fkey" FOREIGN KEY ("salesperson_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_payment_term_id_fkey" FOREIGN KEY ("payment_term_id") REFERENCES "payment_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_shipping_address_id_fkey" FOREIGN KEY ("shipping_address_id") REFERENCES "customer_addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_billing_address_id_fkey" FOREIGN KEY ("billing_address_id") REFERENCES "customer_addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_payment_schedule" ADD CONSTRAINT "sales_order_payment_schedule_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_checks" ADD CONSTRAINT "credit_checks_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_checks" ADD CONSTRAINT "credit_checks_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_overrides" ADD CONSTRAINT "credit_overrides_credit_check_id_fkey" FOREIGN KEY ("credit_check_id") REFERENCES "credit_checks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_overrides" ADD CONSTRAINT "credit_overrides_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_payment_term_id_fkey" FOREIGN KEY ("payment_term_id") REFERENCES "payment_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_allocations" ADD CONSTRAINT "order_allocations_sales_order_line_id_fkey" FOREIGN KEY ("sales_order_line_id") REFERENCES "sales_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_allocations" ADD CONSTRAINT "order_allocations_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_payment_schedule" ADD CONSTRAINT "purchase_order_payment_schedule_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_milestones" ADD CONSTRAINT "purchase_order_milestones_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
