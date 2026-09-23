/**
 * Permission catalogue. Codes are stored in role_permissions; the API guards every endpoint
 * with one of these and the UI hides what the user cannot do.
 */
export const PERMISSIONS = {
  'users.manage': 'Create users, assign roles, reset passwords',
  'roles.view': 'View roles and their permissions',
  'settings.manage': 'Edit company settings (base currency, timezone, tolerances)',
  'audit.view': 'View the audit log',
  'master_data.manage': 'Manage currencies, ports, payment terms, units and packaging',
  'exchange_rate.manage': 'Enter and correct exchange rates',

  'customer.view': 'View customers',
  'customer.view_all': 'See all customers (without it: only customers where you are the salesperson)',
  'customer.create': 'Create customers',
  'customer.edit': 'Edit customers, contacts and addresses',
  'customer.archive': 'Archive / reactivate customers',
  'customer.credit_limit.edit': 'Change credit limits and customer status (hold / block)',
  'credit.override': 'Confirm orders that exceed the customer credit limit',
  'credit.override_block': 'Confirm orders for blocked / on-hold customers or with old overdue amounts',

  'supplier.view': 'View suppliers',
  'supplier.create': 'Create suppliers',
  'supplier.edit': 'Edit suppliers, contacts and addresses',
  'supplier.archive': 'Archive / reactivate suppliers',
  'supplier_bank.view': 'View supplier bank details',
  'supplier_bank.manage': 'Add or revoke supplier bank accounts',
  'supplier_bank.approve': 'Approve supplier bank accounts (must be a different user than the creator)',

  'product.view': 'View products and specifications',
  'product.manage': 'Create and edit products',
  'catalog.manage': 'Manage product categories and specification attributes',

  'quotation.view': 'View quotations',
  'quotation.manage': 'Create, edit, send, revise and convert quotations',
  'quotation.delete': 'Delete draft quotations',

  'sales_order.view': 'View sales orders',
  'sales_order.manage': 'Create and edit draft sales orders',
  'sales_order.confirm': 'Confirm sales orders (runs the credit check)',
  'sales_order.cancel': 'Cancel orders, close lines short, reopen, close',
  'sales_order.delete': 'Delete draft sales orders',

  'purchase_order.view': 'View purchase orders',
  'purchase_order.manage': 'Create and edit draft purchase orders, milestones',
  'purchase_order.confirm': 'Send / confirm / progress purchase orders',
  'purchase_order.cancel': 'Cancel purchase orders',
  'purchase_order.delete': 'Delete draft purchase orders',
  'allocation.manage': 'Link sales order lines to purchase order lines',

  'finance.view_costs': 'See purchase prices, costs and margins',
  'export.data': 'Export lists to Excel',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const ROLE_CODES = ['ADMIN', 'MANAGEMENT', 'SALES', 'PURCHASING', 'LOGISTICS', 'FINANCE', 'VIEWER'] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

const VIEW_ALL: Permission[] = [
  'customer.view',
  'customer.view_all',
  'supplier.view',
  'product.view',
  'quotation.view',
  'sales_order.view',
  'purchase_order.view',
];

export interface RoleDefinition {
  code: RoleCode;
  name: string;
  description: string;
  permissions: readonly Permission[];
}

export const DEFAULT_ROLES: readonly RoleDefinition[] = [
  {
    code: 'ADMIN',
    name: 'Admin',
    description: 'Full access including users and settings',
    permissions: ALL_PERMISSIONS,
  },
  {
    code: 'MANAGEMENT',
    name: 'Management',
    description: 'Everything operational and financial, approvals and overrides',
    permissions: ALL_PERMISSIONS.filter((p) => p !== 'users.manage' && p !== 'settings.manage'),
  },
  {
    code: 'SALES',
    name: 'Sales',
    description: 'Own customers, quotations and sales orders. No purchase costs.',
    permissions: [
      'customer.view',
      'customer.create',
      'customer.edit',
      'supplier.view',
      'product.view',
      'product.manage',
      'quotation.view',
      'quotation.manage',
      'quotation.delete',
      'sales_order.view',
      'sales_order.manage',
      'sales_order.confirm',
      'sales_order.cancel',
      'sales_order.delete',
      'purchase_order.view',
      'export.data',
    ],
  },
  {
    code: 'PURCHASING',
    name: 'Purchasing',
    description: 'Suppliers, purchase orders and allocation to customer orders',
    permissions: [
      ...VIEW_ALL,
      'supplier.create',
      'supplier.edit',
      'supplier.archive',
      'supplier_bank.view',
      'supplier_bank.manage',
      'product.manage',
      'catalog.manage',
      'purchase_order.manage',
      'purchase_order.confirm',
      'purchase_order.cancel',
      'purchase_order.delete',
      'allocation.manage',
      'finance.view_costs',
      'export.data',
    ],
  },
  {
    code: 'LOGISTICS',
    name: 'Logistics',
    description: 'Shipments and documents (Phase 2); read access to orders',
    permissions: [...VIEW_ALL, 'export.data'],
  },
  {
    code: 'FINANCE',
    name: 'Finance',
    description: 'Credit control, bank details approval, exchange rates, costs',
    permissions: [
      ...VIEW_ALL,
      'customer.edit',
      'customer.credit_limit.edit',
      'credit.override',
      'supplier.edit',
      'supplier_bank.view',
      'supplier_bank.manage',
      'supplier_bank.approve',
      'exchange_rate.manage',
      'finance.view_costs',
      'audit.view',
      'roles.view',
      'export.data',
    ],
  },
  {
    code: 'VIEWER',
    name: 'Viewer',
    description: 'Read-only access without costs or margins',
    permissions: VIEW_ALL,
  },
];
