import { Injectable } from '@nestjs/common';
import type { SearchResultDto } from '@fillco/contracts';
import { Actor, can } from '../../common/actor';
import { contains } from '../../common/list';
import { PrismaService } from '../../common/prisma.service';
import { customerScope, viaCustomerScope } from '../../common/scope';

const PER_TYPE = 6;

/**
 * Global search across customers, suppliers, contacts (phone/e-mail), products and document
 * numbers. Each source respects the caller's permissions and customer scope.
 */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(actor: Actor, raw: string): Promise<SearchResultDto[]> {
    const q = raw.trim();
    if (q.length < 2) return [];
    const c = contains(q);
    const tasks: Promise<SearchResultDto[]>[] = [];

    if (can(actor, 'customer.view')) {
      tasks.push(
        this.prisma.customer
          .findMany({
            where: {
              ...customerScope(actor),
              OR: [{ companyName: c }, { code: c }, { email: c }, { phone: c }, { whatsapp: c }, { taxId: c }],
            },
            take: PER_TYPE,
            orderBy: { companyName: 'asc' },
          })
          .then((rows) =>
            rows.map((r) => ({
              type: 'customer' as const,
              id: r.id,
              title: r.companyName,
              subtitle: [r.code, r.countryCode, r.city].filter(Boolean).join(' · '),
              href: `/customers/${r.id}`,
            })),
          ),
        this.prisma.customerContact
          .findMany({
            where: { customer: customerScope(actor), OR: [{ name: c }, { email: c }, { phone: c }, { whatsapp: c }] },
            include: { customer: true },
            take: PER_TYPE,
          })
          .then((rows) =>
            rows.map((r) => ({
              type: 'contact' as const,
              id: r.id,
              title: `${r.name} (${r.customer.companyName})`,
              subtitle: [r.phone, r.email].filter(Boolean).join(' · ') || null,
              href: `/customers/${r.customerId}`,
            })),
          ),
      );
    }
    if (can(actor, 'supplier.view')) {
      tasks.push(
        this.prisma.supplier
          .findMany({
            where: { companyId: actor.companyId, OR: [{ companyName: c }, { code: c }, { email: c }, { phone: c }, { whatsapp: c }] },
            take: PER_TYPE,
            orderBy: { companyName: 'asc' },
          })
          .then((rows) =>
            rows.map((r) => ({
              type: 'supplier' as const,
              id: r.id,
              title: r.companyName,
              subtitle: [r.code, r.supplierType, r.countryCode].filter(Boolean).join(' · '),
              href: `/suppliers/${r.id}`,
            })),
          ),
        this.prisma.supplierContact
          .findMany({
            where: { supplier: { companyId: actor.companyId }, OR: [{ name: c }, { email: c }, { phone: c }, { whatsapp: c }] },
            include: { supplier: true },
            take: PER_TYPE,
          })
          .then((rows) =>
            rows.map((r) => ({
              type: 'contact' as const,
              id: r.id,
              title: `${r.name} (${r.supplier.companyName})`,
              subtitle: [r.phone, r.email].filter(Boolean).join(' · ') || null,
              href: `/suppliers/${r.supplierId}`,
            })),
          ),
      );
    }
    if (can(actor, 'product.view')) {
      tasks.push(
        this.prisma.product
          .findMany({
            where: { OR: [{ name: c }, { code: c }, { variants: { some: { OR: [{ displayName: c }, { sku: c }] } } }] },
            include: { category: true },
            take: PER_TYPE,
          })
          .then((rows) =>
            rows.map((r) => ({
              type: 'product' as const,
              id: r.id,
              title: r.name,
              subtitle: `${r.code} · ${r.category.name}`,
              href: `/products/${r.id}`,
            })),
          ),
      );
    }
    if (can(actor, 'quotation.view')) {
      tasks.push(
        this.prisma.quotation
          .findMany({
            where: { companyId: actor.companyId, ...viaCustomerScope(actor), status: { not: 'SUPERSEDED' }, number: c },
            include: { customer: true },
            take: PER_TYPE,
            orderBy: { createdAt: 'desc' },
          })
          .then((rows) =>
            rows.map((r) => ({
              type: 'quotation' as const,
              id: r.id,
              title: `${r.number} rev ${r.revision}`,
              subtitle: `${r.customer.companyName} · ${r.status}`,
              href: `/quotations/${r.id}`,
            })),
          ),
      );
    }
    if (can(actor, 'sales_order.view')) {
      tasks.push(
        this.prisma.salesOrder
          .findMany({
            where: { companyId: actor.companyId, ...viaCustomerScope(actor), OR: [{ number: c }, { customerPoRef: c }] },
            include: { customer: true },
            take: PER_TYPE,
            orderBy: { createdAt: 'desc' },
          })
          .then((rows) =>
            rows.map((r) => ({
              type: 'sales_order' as const,
              id: r.id,
              title: r.number,
              subtitle: `${r.customer.companyName}${r.customerPoRef ? ` · PO ${r.customerPoRef}` : ''} · ${r.status}`,
              href: `/sales-orders/${r.id}`,
            })),
          ),
      );
    }
    if (can(actor, 'purchase_order.view')) {
      tasks.push(
        this.prisma.purchaseOrder
          .findMany({
            where: { companyId: actor.companyId, OR: [{ number: c }, { supplierRef: c }] },
            include: { supplier: true },
            take: PER_TYPE,
            orderBy: { createdAt: 'desc' },
          })
          .then((rows) =>
            rows.map((r) => ({
              type: 'purchase_order' as const,
              id: r.id,
              title: r.number,
              subtitle: `${r.supplier.companyName}${r.supplierRef ? ` · ref ${r.supplierRef}` : ''} · ${r.status}`,
              href: `/purchases/${r.id}`,
            })),
          ),
      );
    }
    const results = (await Promise.all(tasks)).flat();
    // Exact document-number hits first.
    const upper = q.toUpperCase();
    return results.sort((a, b) => Number(b.title.toUpperCase() === upper) - Number(a.title.toUpperCase() === upper));
  }
}
