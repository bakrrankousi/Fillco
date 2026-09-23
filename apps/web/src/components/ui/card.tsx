import { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-lg border border-line bg-surface shadow-sm', className)}>
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  actions,
  subtitle,
}: {
  title: ReactNode;
  actions?: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
      <div>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('p-4', className)}>{children}</div>;
}

/** KPI tile for the dashboard. */
export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'neutral' | 'warning' | 'critical' | 'good';
  href?: string;
}) {
  const accent = {
    neutral: 'border-l-slate-300',
    warning: 'border-l-amber-400',
    critical: 'border-l-red-500',
    good: 'border-l-emerald-500',
  }[tone];
  const body = (
    <div
      className={cn(
        'h-full rounded-lg border border-line border-l-4 bg-white px-4 py-3 shadow-sm',
        accent,
        href && 'transition hover:shadow-md',
      )}
    >
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight text-ink tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
  return href ? (
    <a href={href} className="block h-full">
      {body}
    </a>
  ) : (
    body
  );
}
