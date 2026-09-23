import { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { humanize, soStatusLabel } from '@/lib/format';
import type { SoDisplayStatus } from '@fillco/domain';

/** Colours carry meaning consistently: normal, warning, overdue, critical, completed, inactive. */
export type Tone = 'neutral' | 'info' | 'progress' | 'warning' | 'overdue' | 'critical' | 'success' | 'muted';

const tones: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  info: 'bg-sky-50 text-sky-800 ring-sky-200',
  progress: 'bg-brand-50 text-brand-700 ring-brand-100',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  overdue: 'bg-orange-50 text-orange-800 ring-orange-200',
  critical: 'bg-red-50 text-red-700 ring-red-200',
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  muted: 'bg-slate-50 text-slate-500 ring-slate-200',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  // generic
  ACTIVE: 'success',
  INACTIVE: 'muted',
  PROSPECT: 'info',
  ON_HOLD: 'warning',
  BLOCKED: 'critical',
  // quotations
  DRAFT: 'neutral',
  SENT: 'info',
  ACCEPTED: 'success',
  REJECTED: 'muted',
  EXPIRED: 'warning',
  SUPERSEDED: 'muted',
  CONVERTED: 'success',
  // sales orders (stored)
  PENDING_CONFIRMATION: 'info',
  CONFIRMED: 'progress',
  CLOSED: 'success',
  CANCELLED: 'muted',
  // purchase orders
  IN_PRODUCTION: 'progress',
  READY: 'success',
  // lines
  OPEN: 'neutral',
  CLOSED_SHORT: 'warning',
  // bank accounts
  PENDING_APPROVAL: 'warning',
  APPROVED: 'success',
  REVOKED: 'muted',
  // credit
  PASS: 'success',
  WARN: 'warning',
  BLOCK: 'critical',
  // schedule
  FIXED: 'neutral',
  PENDING_EVENT: 'info',
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={STATUS_TONES[status] ?? 'neutral'}>{label ?? humanize(status)}</Badge>;
}

const SO_TONES: Record<SoDisplayStatus, Tone> = {
  DRAFT: 'neutral',
  PENDING_CONFIRMATION: 'info',
  ON_HOLD: 'warning',
  CONFIRMED: 'progress',
  PURCHASE_REQUIRED: 'overdue',
  PURCHASING: 'info',
  PARTIALLY_PURCHASED: 'warning',
  FULLY_PURCHASED: 'progress',
  PREPARING_SHIPMENT: 'progress',
  PARTIALLY_SHIPPED: 'progress',
  FULLY_SHIPPED: 'progress',
  DELIVERED: 'success',
  COMPLETED: 'success',
  CANCELLED: 'muted',
};

export function SoStatusBadge({ status }: { status: SoDisplayStatus }) {
  return <Badge tone={SO_TONES[status]}>{soStatusLabel(status)}</Badge>;
}
