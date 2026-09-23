'use client';

import { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Tabs<K extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: K; label: ReactNode; count?: number; hidden?: boolean }[];
  active: K;
  onChange: (key: K) => void;
}) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
      {tabs
        .filter((t) => !t.hidden)
        .map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={active === t.key}
            onClick={() => onChange(t.key)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
              active === t.key
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">
                {t.count}
              </span>
            )}
          </button>
        ))}
    </div>
  );
}
