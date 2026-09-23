import { Injectable } from '@nestjs/common';
import { Prisma } from '@fillco/db';
import type { Actor } from './actor';
import type { Tx } from './prisma.service';

type Plain = Record<string, unknown>;

/** Keys that must never reach the audit log, at any depth. */
const SECRET_KEY = /password|secret|token|hash/i;

function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toFixed();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Plain)
        .filter(([k]) => !SECRET_KEY.test(k))
        .map(([k, v]) => [k, normalize(v)]),
    );
  }
  return value;
}

const IGNORED = new Set([
  'id',
  'updatedAt',
  'updatedById',
  'version',
  'createdAt',
  'createdById',
  'companyId',
]);

/**
 * Only the record's own scalar fields that changed, as { before, after }. Related records
 * (objects / arrays loaded through includes) are skipped; secrets are never logged.
 */
export function diff(before: Plain | null, after: Plain | null): { before: Plain; after: Plain } | null {
  const b = (normalize(before ?? {}) as Plain) ?? {};
  const a = (normalize(after ?? {}) as Plain) ?? {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const out = { before: {} as Plain, after: {} as Plain };
  for (const k of keys) {
    if (IGNORED.has(k)) continue;
    const bv = b[k] ?? null;
    const av = a[k] ?? null;
    if ((typeof bv === 'object' && bv !== null) || (typeof av === 'object' && av !== null)) continue;
    if (JSON.stringify(bv) !== JSON.stringify(av)) {
      out.before[k] = bv;
      out.after[k] = av;
    }
  }
  return Object.keys(out.after).length ? out : null;
}

export interface AuditEntry {
  entityType: string;
  entityId: string;
  action: string;
  before?: Plain | null;
  after?: Plain | null;
  /** Arbitrary extra data when before/after is not meaningful. */
  details?: Plain;
  reason?: string | null;
}

export interface ActivityEntry {
  eventType: string;
  entityType: string;
  entityId: string;
  summary: string;
  customerId?: string | null;
  supplierId?: string | null;
  quotationId?: string | null;
  salesOrderId?: string | null;
  purchaseOrderId?: string | null;
  payload?: Plain;
}

/**
 * Writes audit log, business timeline and integration outbox rows inside the caller's transaction,
 * so they commit or roll back together with the business change.
 */
@Injectable()
export class AuditService {
  async log(tx: Tx, actor: Actor | null, entry: AuditEntry): Promise<void> {
    const changes =
      entry.details !== undefined
        ? (normalize(entry.details) as Plain)
        : entry.before !== undefined || entry.after !== undefined
          ? diff(entry.before ?? null, entry.after ?? null)
          : null;
    await tx.auditLog.create({
      data: {
        userId: actor?.userId ?? null,
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        changes: (changes ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        reason: entry.reason ?? null,
        requestId: actor?.requestId ?? null,
        ip: actor?.ip ?? null,
      },
    });
  }

  async activity(tx: Tx, actor: Actor | null, entry: ActivityEntry): Promise<void> {
    await tx.activityEvent.create({
      data: {
        eventType: entry.eventType,
        entityType: entry.entityType,
        entityId: entry.entityId,
        summary: entry.summary,
        customerId: entry.customerId ?? null,
        supplierId: entry.supplierId ?? null,
        quotationId: entry.quotationId ?? null,
        salesOrderId: entry.salesOrderId ?? null,
        purchaseOrderId: entry.purchaseOrderId ?? null,
        payload: entry.payload ? (normalize(entry.payload) as Prisma.InputJsonValue) : Prisma.JsonNull,
        userId: actor?.userId ?? null,
      },
    });
  }

  async outbox(
    tx: Tx,
    eventType: string,
    aggregateType: string,
    aggregateId: string,
    payload: Plain,
  ): Promise<void> {
    await tx.outboxEvent.create({
      data: { eventType, aggregateType, aggregateId, payload: normalize(payload) as Prisma.InputJsonValue },
    });
  }
}
