import { Injectable } from '@nestjs/common';
import { Decimal, ExchangeRateRecord, IsoDate, resolveRate, toBase } from '@fillco/domain';
import { dateToIso, isoToDate } from '@fillco/domain';
import type { Tx } from './prisma.service';
import { PrismaService } from './prisma.service';

/** Resolves stored exchange rates for documents and reports. */
@Injectable()
export class FxService {
  constructor(private readonly prisma: PrismaService) {}

  /** Rate to convert 1 unit of `from` into `to`, using the latest rate on or before `onDate`. */
  async rate(from: string, to: string, onDate: IsoDate, tx: Tx = this.prisma): Promise<Decimal> {
    if (from === to) return new Decimal(1);
    const rows = await tx.exchangeRate.findMany({
      where: {
        rateDate: { lte: isoToDate(onDate) },
        OR: [
          { fromCurrency: from, toCurrency: to },
          { fromCurrency: to, toCurrency: from },
        ],
      },
      orderBy: [{ rateDate: 'desc' }, { createdAt: 'desc' }],
      take: 4,
    });
    const records: ExchangeRateRecord[] = rows.map((r) => ({
      rateDate: dateToIso(r.rateDate),
      fromCurrency: r.fromCurrency,
      toCurrency: r.toCurrency,
      rate: r.rate.toFixed(),
    }));
    return resolveRate(records, from, to, onDate);
  }

  async convert(amount: Decimal, from: string, to: string, onDate: IsoDate, minorUnits = 2, tx?: Tx): Promise<Decimal> {
    return toBase(amount, await this.rate(from, to, onDate, tx), minorUnits);
  }
}
