import { Injectable } from '@nestjs/common';
import { todayInTimeZone } from '@fillco/domain';
import { PrismaService, Tx } from './prisma.service';

export interface CompanyContext {
  id: string;
  name: string;
  baseCurrency: string;
  baseMinorUnits: number;
  timezone: string;
  blockOverdueDays: number;
  defaultTolerancePct: string;
}

/** Company settings used by nearly every calculation (base currency, timezone). */
@Injectable()
export class CompanyService {
  constructor(private readonly prisma: PrismaService) {}

  async get(companyId: string, tx: Tx = this.prisma): Promise<CompanyContext> {
    const c = await tx.company.findUniqueOrThrow({
      where: { id: companyId },
      include: { baseCurrencyRef: true },
    });
    return {
      id: c.id,
      name: c.name,
      baseCurrency: c.baseCurrency,
      baseMinorUnits: c.baseCurrencyRef.minorUnits,
      timezone: c.timezone,
      blockOverdueDays: c.blockOverdueDays,
      defaultTolerancePct: c.defaultTolerancePct.toFixed(),
    };
  }

  /** Today's business date in the company timezone. */
  today(company: Pick<CompanyContext, 'timezone'>): string {
    return todayInTimeZone(company.timezone);
  }

  async minorUnits(currency: string, tx: Tx = this.prisma): Promise<number> {
    const c = await tx.currency.findUnique({ where: { code: currency } });
    if (!c) throw new Error(`Unknown currency ${currency}`);
    return c.minorUnits;
  }
}
