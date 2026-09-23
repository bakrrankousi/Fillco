import type { Prisma } from '@fillco/db';
import type { Actor } from './actor';

/**
 * Row-level scope: users without customer.view_all only see customers where they are the
 * salesperson, and documents of those customers.
 */
export function customerScope(actor: Actor): Prisma.CustomerWhereInput {
  const base: Prisma.CustomerWhereInput = { companyId: actor.companyId };
  return actor.permissions.has('customer.view_all') ? base : { ...base, salespersonId: actor.userId };
}

export function viaCustomerScope(actor: Actor): { customer?: Prisma.CustomerWhereInput } {
  return actor.permissions.has('customer.view_all') ? {} : { customer: { salespersonId: actor.userId } };
}

export function canSeeCosts(actor: Actor): boolean {
  return actor.permissions.has('finance.view_costs');
}
