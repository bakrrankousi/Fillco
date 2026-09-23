import { Injectable } from '@nestjs/common';
import type { Tx } from './prisma.service';

export type SequenceType = 'QT' | 'SO' | 'PO' | 'CUST' | 'SUPP';

const FORMATS: Record<SequenceType, { yearly: boolean; prefix: (year: number) => string; pad: number }> = {
  QT: { yearly: true, prefix: (y) => `QT-${y}-`, pad: 5 },
  SO: { yearly: true, prefix: (y) => `SO-${y}-`, pad: 5 },
  PO: { yearly: true, prefix: (y) => `PO-${y}-`, pad: 5 },
  CUST: { yearly: false, prefix: () => 'C-', pad: 5 },
  SUPP: { yearly: false, prefix: () => 'S-', pad: 5 },
};

/**
 * Gap-free document numbers (SO-2026-00125). The counter row is incremented with an atomic upsert
 * inside the caller's transaction, so a rolled-back document never consumes a number.
 */
@Injectable()
export class SequenceService {
  async next(tx: Tx, companyId: string, type: SequenceType, year: number): Promise<string> {
    const fmt = FORMATS[type];
    const y = fmt.yearly ? year : 0;
    const prefix = fmt.prefix(year);
    const rows = await tx.$queryRaw<{ value: number }[]>`
      INSERT INTO document_sequences (company_id, doc_type, year, prefix, next_value)
      VALUES (${companyId}::uuid, ${type}, ${y}, ${prefix}, 2)
      ON CONFLICT (company_id, doc_type, year)
      DO UPDATE SET next_value = document_sequences.next_value + 1
      RETURNING next_value - 1 AS value`;
    const value = rows[0]?.value;
    if (value === undefined) throw new Error('Sequence allocation failed');
    return `${prefix}${String(value).padStart(fmt.pad, '0')}`;
  }
}
