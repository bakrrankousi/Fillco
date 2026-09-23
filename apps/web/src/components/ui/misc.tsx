import Link from 'next/link';
import { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/api';

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-4 w-4 animate-spin text-current', className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumb,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: { label: string; href: string };
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {breadcrumb && (
          <Link href={breadcrumb.href} className="text-xs font-medium text-muted hover:text-brand-600">
            ← {breadcrumb.label}
          </Link>
        )}
        <h1 className="truncate text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <div className="mt-0.5 text-sm text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-white px-6 py-10 text-center">
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function ErrorBox({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  return (
    <div
      role="alert"
      className={cn('rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800', className)}
    >
      {errorMessage(error)}
    </div>
  );
}

export function Notice({
  tone = 'info',
  children,
  className,
}: {
  tone?: 'info' | 'warning' | 'success';
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  };
  return <div className={cn('rounded-md border px-3 py-2 text-sm', tones[tone], className)}>{children}</div>;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-muted">
      <Spinner /> {label}
    </div>
  );
}

/** Label / value pairs in a responsive grid. */
export function KeyValues({ items, columns = 3 }: { items: [ReactNode, ReactNode][]; columns?: 2 | 3 | 4 }) {
  const cols = {
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-2 lg:grid-cols-3',
    4: 'sm:grid-cols-2 lg:grid-cols-4',
  }[columns];
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-3', cols)}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs font-medium tracking-wide text-muted uppercase">{k}</dt>
          <dd className="mt-0.5 truncate text-sm text-ink">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ProgressBar({
  value,
  tone = 'brand',
}: {
  value: number;
  tone?: 'brand' | 'green' | 'amber';
}) {
  const colors = { brand: 'bg-brand-500', green: 'bg-emerald-500', amber: 'bg-amber-500' };
  const v = Math.max(0, Math.min(100, value));
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
      role="progressbar"
      aria-valuenow={v}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn('h-full rounded-full', colors[v >= 100 && tone === 'brand' ? 'green' : tone])}
        style={{ width: `${v}%` }}
      />
    </div>
  );
}
