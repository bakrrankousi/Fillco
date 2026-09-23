import { dec, Decimal, DecimalInput, max, sum } from './decimal';
import { OrderLineStatus, SalesOrderStatus } from './statuses';

/** Quantities for one sales order line, all in the product base unit (KG). */
export interface SoLineQuantities {
  ordered: DecimalInput;
  /** Allocated to POs the supplier has confirmed. */
  purchasedCommitted: DecimalInput;
  /** Allocated to POs still in draft / sent. */
  purchasedPending: DecimalInput;
  /** Loaded on shipments (Phase 2). */
  shipped?: DecimalInput;
  /** Delivered to the customer (Phase 2). */
  delivered?: DecimalInput;
  /** On posted invoices net of credit notes (Phase 2). */
  invoiced?: DecimalInput;
  /** Accepted over/under delivery, percent (e.g. 5 = ±5%). */
  tolerancePct?: DecimalInput;
  lineStatus: OrderLineStatus;
  /** A shipment exists for this line that has not been loaded yet (Phase 2). */
  shipmentInPreparation?: boolean;
}

export interface SoLineProgress {
  ordered: Decimal;
  purchased: Decimal;
  purchasedCommitted: Decimal;
  shipped: Decimal;
  delivered: Decimal;
  invoiced: Decimal;
  remainingToPurchase: Decimal;
  remainingToShip: Decimal;
  remainingToInvoice: Decimal;
  fullyPurchased: boolean;
  fullyShipped: boolean;
  fullyDelivered: boolean;
  /** Cancelled lines are ignored by order-level status. */
  active: boolean;
}

function lowerBound(ordered: Decimal, tolerancePct: Decimal): Decimal {
  return ordered.times(new Decimal(100).minus(tolerancePct)).div(100);
}

export function upperBound(ordered: DecimalInput, tolerancePct: DecimalInput = 0): Decimal {
  return dec(ordered).times(new Decimal(100).plus(dec(tolerancePct))).div(100);
}

/**
 * Example: ordered 100 MT, shipment 1 loads 40 MT → shipped 40, remaining 60.
 * A line counts as fully shipped/purchased once within the tolerance band, or when closed short.
 */
export function soLineProgress(q: SoLineQuantities): SoLineProgress {
  const ordered = dec(q.ordered);
  const tol = dec(q.tolerancePct ?? 0);
  const purchasedCommitted = dec(q.purchasedCommitted);
  const purchased = purchasedCommitted.plus(dec(q.purchasedPending));
  const shipped = dec(q.shipped ?? 0);
  const delivered = dec(q.delivered ?? 0);
  const invoiced = dec(q.invoiced ?? 0);
  const closed = q.lineStatus !== 'OPEN';
  const floor = lowerBound(ordered, tol);
  const zero = new Decimal(0);

  return {
    ordered,
    purchased,
    purchasedCommitted,
    shipped,
    delivered,
    invoiced,
    remainingToPurchase: closed ? zero : max(0, ordered.minus(purchased)),
    remainingToShip: closed ? zero : max(0, ordered.minus(shipped)),
    remainingToInvoice: max(0, shipped.minus(invoiced)),
    fullyPurchased: closed || purchasedCommitted.gte(floor),
    fullyShipped: closed || shipped.gte(floor),
    fullyDelivered: closed ? delivered.gte(shipped) : delivered.gte(floor),
    active: q.lineStatus !== 'CANCELLED',
  };
}

export class AllocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AllocationError';
  }
}

export interface AllocationCheck {
  qty: DecimalInput;
  soLineOrdered: DecimalInput;
  soLineTolerancePct?: DecimalInput;
  /** Already allocated to this SO line (excluding the allocation being changed). */
  soLineAllocated: DecimalInput;
  poLineQty: DecimalInput;
  /** Already allocated from this PO line (excluding the allocation being changed). */
  poLineAllocated: DecimalInput;
}

/** Maximum quantity that can still be allocated between a SO line and a PO line. */
export function maxAllocatable(c: Omit<AllocationCheck, 'qty'>): Decimal {
  const soRoom = upperBound(c.soLineOrdered, c.soLineTolerancePct).minus(dec(c.soLineAllocated));
  const poRoom = dec(c.poLineQty).minus(dec(c.poLineAllocated));
  return max(0, Decimal.min(soRoom, poRoom));
}

/** Throws if the allocation would over-commit either the customer line or the supplier line. */
export function assertAllocation(c: AllocationCheck): void {
  const qty = dec(c.qty);
  if (qty.lte(0)) throw new AllocationError('Allocation quantity must be greater than zero');
  const soRoom = upperBound(c.soLineOrdered, c.soLineTolerancePct).minus(dec(c.soLineAllocated));
  if (qty.gt(soRoom))
    throw new AllocationError(
      `Sales order line can take at most ${max(0, soRoom).toFixed(4)} more (ordered incl. tolerance)`,
    );
  const poRoom = dec(c.poLineQty).minus(dec(c.poLineAllocated));
  if (qty.gt(poRoom))
    throw new AllocationError(`Purchase order line has only ${max(0, poRoom).toFixed(4)} unallocated`);
}

/** The single status shown to users, from the business's own status list. */
export const SO_DISPLAY_STATUSES = [
  'DRAFT',
  'PENDING_CONFIRMATION',
  'ON_HOLD',
  'CONFIRMED',
  'PURCHASE_REQUIRED',
  'PURCHASING',
  'PARTIALLY_PURCHASED',
  'FULLY_PURCHASED',
  'PREPARING_SHIPMENT',
  'PARTIALLY_SHIPPED',
  'FULLY_SHIPPED',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
] as const;
export type SoDisplayStatus = (typeof SO_DISPLAY_STATUSES)[number];

export const SO_DISPLAY_STATUS_LABELS: Record<SoDisplayStatus, string> = {
  DRAFT: 'Draft',
  PENDING_CONFIRMATION: 'Pending Customer Confirmation',
  ON_HOLD: 'On Hold',
  CONFIRMED: 'Confirmed',
  PURCHASE_REQUIRED: 'Purchase Required',
  PURCHASING: 'Purchasing',
  PARTIALLY_PURCHASED: 'Partially Purchased',
  FULLY_PURCHASED: 'Fully Purchased',
  PREPARING_SHIPMENT: 'Preparing Shipment',
  PARTIALLY_SHIPPED: 'Partially Shipped',
  FULLY_SHIPPED: 'Fully Shipped',
  DELIVERED: 'Delivered',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export type DimensionStatus = 'NONE' | 'PENDING' | 'PARTIAL' | 'FULL';

export interface SalesOrderDerivedStatus {
  display: SoDisplayStatus;
  purchasing: DimensionStatus;
  shipping: DimensionStatus;
  purchasedPct: Decimal;
  shippedPct: Decimal;
  ordered: Decimal;
  purchased: Decimal;
  shipped: Decimal;
  remainingToPurchase: Decimal;
  remainingToShip: Decimal;
}

function pct(part: Decimal, whole: Decimal): Decimal {
  if (whole.isZero()) return new Decimal(0);
  return Decimal.min(part.div(whole).times(100), 100).toDecimalPlaces(1);
}

/**
 * Derives the order's display status from its stored commercial status and line quantities.
 * Precedence: Cancelled > Completed > Delivered > Fully Shipped > Partially Shipped >
 * Preparing Shipment > Fully Purchased > Partially Purchased > Purchasing > Purchase Required.
 */
export function deriveSalesOrderStatus(
  status: SalesOrderStatus,
  lines: readonly SoLineQuantities[],
): SalesOrderDerivedStatus {
  const progress = lines.map(soLineProgress).filter((p) => p.active);
  const ordered = sum(progress.map((p) => p.ordered));
  const purchased = sum(progress.map((p) => p.purchased));
  const committed = sum(progress.map((p) => p.purchasedCommitted));
  const shipped = sum(progress.map((p) => p.shipped));
  const any = progress.length > 0;

  const purchasing: DimensionStatus =
    any && progress.every((p) => p.fullyPurchased)
      ? 'FULL'
      : committed.gt(0)
        ? 'PARTIAL'
        : purchased.gt(0)
          ? 'PENDING'
          : 'NONE';
  const shipping: DimensionStatus =
    any && progress.every((p) => p.fullyShipped) && shipped.gt(0)
      ? 'FULL'
      : shipped.gt(0)
        ? 'PARTIAL'
        : lines.some((l) => l.shipmentInPreparation)
          ? 'PENDING'
          : 'NONE';

  const base = {
    purchasing,
    shipping,
    purchasedPct: pct(purchased, ordered),
    shippedPct: pct(shipped, ordered),
    ordered,
    purchased,
    shipped,
    remainingToPurchase: sum(progress.map((p) => p.remainingToPurchase)),
    remainingToShip: sum(progress.map((p) => p.remainingToShip)),
  };

  const display = ((): SoDisplayStatus => {
    switch (status) {
      case 'CANCELLED':
        return 'CANCELLED';
      case 'CLOSED':
        return 'COMPLETED';
      case 'DRAFT':
        return 'DRAFT';
      case 'PENDING_CONFIRMATION':
        return 'PENDING_CONFIRMATION';
      case 'ON_HOLD':
        return 'ON_HOLD';
      case 'CONFIRMED':
        break;
    }
    if (!any) return 'CONFIRMED';
    if (shipping === 'FULL' && progress.every((p) => p.fullyDelivered)) return 'DELIVERED';
    if (shipping === 'FULL') return 'FULLY_SHIPPED';
    if (shipping === 'PARTIAL') return 'PARTIALLY_SHIPPED';
    if (shipping === 'PENDING') return 'PREPARING_SHIPMENT';
    if (purchasing === 'FULL') return 'FULLY_PURCHASED';
    if (purchasing === 'PARTIAL') return 'PARTIALLY_PURCHASED';
    if (purchasing === 'PENDING') return 'PURCHASING';
    return 'PURCHASE_REQUIRED';
  })();

  return { display, ...base };
}
