'use client';

import type { AuditLogDto } from '@fillco/contracts';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { dateTime, humanize } from '@/lib/format';
import { Card, CardHeader } from './ui/card';
import { ErrorBox, Loading } from './ui/misc';

function renderValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '∅';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function ChangeList({ changes }: { changes: unknown }) {
  if (!changes || typeof changes !== 'object') return null;
  const c = changes as { before?: Record<string, unknown>; after?: Record<string, unknown> };
  if (!c.before && !c.after) {
    return (
      <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
        {Object.entries(changes as Record<string, unknown>).map(([k, v]) => (
          <li key={k}>
            <span className="text-muted">{humanize(k)}:</span> {renderValue(v)}
          </li>
        ))}
      </ul>
    );
  }
  const keys = [...new Set([...Object.keys(c.before ?? {}), ...Object.keys(c.after ?? {})])];
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
      {keys.map((k) => (
        <li key={k}>
          <span className="text-muted">{humanize(k)}:</span>{' '}
          <span className="line-through decoration-slate-400">{renderValue(c.before?.[k])}</span> →{' '}
          <span className="font-medium text-ink">{renderValue(c.after?.[k])}</span>
        </li>
      ))}
    </ul>
  );
}

/** Who changed what and when, for one record. */
export function AuditTrail({ entityType, entityId }: { entityType: string; entityId: string }) {
  const logs = useQuery({
    queryKey: ['audit', entityType, entityId],
    queryFn: () => api.get<AuditLogDto[]>('/audit-logs', { entityType, entityId }),
  });
  return (
    <Card>
      <CardHeader title="Change history" subtitle="From the immutable audit log" />
      {logs.error ? (
        <ErrorBox error={logs.error} className="m-4" />
      ) : !logs.data ? (
        <Loading />
      ) : logs.data.length === 0 ? (
        <p className="p-4 text-sm text-muted">No changes recorded.</p>
      ) : (
        <ol className="divide-y divide-line">
          {logs.data.map((l) => (
            <li key={l.id} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  <span className="font-medium">{humanize(l.action)}</span>{' '}
                  <span className="text-muted">by {l.user?.name ?? 'system'}</span>
                </span>
                <span className="text-xs text-muted">{dateTime(l.occurredAt)}</span>
              </div>
              {l.reason && <p className="mt-0.5 text-xs text-slate-700">Reason: {l.reason}</p>}
              <ChangeList changes={l.changes} />
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
