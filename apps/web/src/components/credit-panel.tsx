'use client';

import type { CreditExposureDto } from '@fillco/contracts';
import { money, pct } from '@/lib/format';
import { Badge } from './ui/badge';
import { KeyValues, ProgressBar } from './ui/misc';

export function CreditPanel({ exposure }: { exposure: CreditExposureDto }) {
  const used = exposure.utilizationPct ? Number(exposure.utilizationPct) : 0;
  const tone = used >= 100 ? 'critical' : used >= 85 ? 'warning' : 'success';
  const c = exposure.currency;
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 flex items-center justify-between text-sm">
          <span className="font-medium">Credit used</span>
          <Badge tone={tone}>
            {exposure.utilizationPct === null ? 'No credit limit' : pct(exposure.utilizationPct)}
          </Badge>
        </div>
        <ProgressBar value={used} tone={used >= 85 ? 'amber' : 'brand'} />
      </div>
      <KeyValues
        columns={4}
        items={[
          ['Credit limit', money(exposure.creditLimit, c)],
          ['Open orders (uninvoiced)', money(exposure.openOrders, c)],
          ['Outstanding invoices', money(exposure.openAr, c)],
          ['Overdue', money(exposure.overdueAmount, c)],
          ['Not yet due', money(exposure.notYetDue, c)],
          ['Unapplied payments', money(exposure.unappliedCredit, c)],
          ['Total exposure', <strong key="e">{money(exposure.exposure, c)}</strong>],
          [
            'Available credit',
            <strong
              key="a"
              className={Number(exposure.availableCredit) < 0 ? 'text-red-700' : 'text-emerald-700'}
            >
              {money(exposure.availableCredit, c)}
            </strong>,
          ],
        ]}
      />
      <p className="text-xs text-muted">
        Invoices and payments are added in Phase 2. Until then exposure is made of confirmed, uninvoiced
        orders.
      </p>
    </div>
  );
}
