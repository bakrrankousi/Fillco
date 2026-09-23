import { Injectable } from '@nestjs/common';
import type { CreditExposureDto } from '@fillco/contracts';
import { dec, Decimal, evaluateCredit, CreditEvaluation, roundMoney, sum, toBase } from '@fillco/domain';
import { CompanyService } from '../../common/company.service';
import { FxService } from '../../common/fx.service';
import { PrismaService, Tx } from '../../common/prisma.service';

export interface ExposureFigures {
  currency: string;
  creditLimit: Decimal;
  openAr: Decimal;
  overdueAmount: Decimal;
  maxDaysOverdue: number;
  notYetDue: Decimal;
  openOrders: Decimal;
  unappliedCredit: Decimal;
  exposure: Decimal;
  available: Decimal;
}

/**
 * Customer credit exposure. Amounts are converted to the customer's credit-limit currency.
 * Receivables and unapplied payments come from invoicing (Phase 2); until then they are zero and
 * exposure consists of confirmed, uninvoiced orders.
 */
@Injectable()
export class CreditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fx: FxService,
    private readonly company: CompanyService,
  ) {}

  async exposure(
    companyId: string,
    customerId: string,
    tx: Tx = this.prisma,
    excludeOrderId?: string,
  ): Promise<ExposureFigures> {
    const company = await this.company.get(companyId, tx);
    const today = this.company.today(company);
    const customer = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
    const limitCurrency = customer.creditLimitCurrency;
    const limitMinor = await this.company.minorUnits(limitCurrency, tx);

    const orders = await tx.salesOrder.findMany({
      where: {
        customerId,
        status: { in: ['CONFIRMED', 'ON_HOLD'] },
        ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
      },
      include: { lines: true },
    });
    // Uninvoiced value of open lines, in base currency at each order's frozen rate.
    const openOrdersBase = sum(
      orders.map((o) =>
        toBase(
          sum(o.lines.filter((l) => l.lineStatus === 'OPEN').map((l) => l.lineTotal.toFixed())),
          o.fxRate.toFixed(),
          company.baseMinorUnits,
        ),
      ),
    );
    const baseToLimit =
      limitCurrency === company.baseCurrency
        ? new Decimal(1)
        : await this.fx.rate(company.baseCurrency, limitCurrency, today, tx);
    const openOrders = roundMoney(openOrdersBase.times(baseToLimit), limitMinor);

    const openAr = new Decimal(0);
    const overdueAmount = new Decimal(0);
    const unappliedCredit = new Decimal(0);
    const creditLimit = dec(customer.creditLimit.toFixed());
    const exposure = openAr.plus(openOrders).minus(unappliedCredit);
    return {
      currency: limitCurrency,
      creditLimit,
      openAr,
      overdueAmount,
      maxDaysOverdue: 0,
      notYetDue: openAr.minus(overdueAmount),
      openOrders,
      unappliedCredit,
      exposure,
      available: creditLimit.minus(exposure),
    };
  }

  toDto(e: ExposureFigures): CreditExposureDto {
    return {
      currency: e.currency,
      creditLimit: e.creditLimit.toFixed(2),
      openAr: e.openAr.toFixed(2),
      overdueAmount: e.overdueAmount.toFixed(2),
      notYetDue: e.notYetDue.toFixed(2),
      openOrders: e.openOrders.toFixed(2),
      unappliedCredit: e.unappliedCredit.toFixed(2),
      exposure: e.exposure.toFixed(2),
      availableCredit: e.available.toFixed(2),
      utilizationPct: e.creditLimit.isZero() ? null : e.exposure.div(e.creditLimit).times(100).toFixed(1),
    };
  }

  /**
   * Evaluates a new order: its value (converted to the limit currency) against current exposure.
   * `securedPct` is the share payable before goods leave (advance / before-loading installments).
   */
  async evaluateOrder(
    companyId: string,
    customerId: string,
    orderId: string,
    orderValueBase: Decimal,
    securedPct: Decimal,
    tx: Tx = this.prisma,
  ): Promise<CreditEvaluation> {
    const company = await this.company.get(companyId, tx);
    const customer = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
    const figures = await this.exposure(companyId, customerId, tx, orderId);
    const limitMinor = await this.company.minorUnits(figures.currency, tx);
    const baseToLimit =
      figures.currency === company.baseCurrency
        ? new Decimal(1)
        : await this.fx.rate(company.baseCurrency, figures.currency, this.company.today(company), tx);
    return evaluateCredit({
      creditLimit: figures.creditLimit,
      openAr: figures.openAr,
      overdueAmount: figures.overdueAmount,
      maxDaysOverdue: figures.maxDaysOverdue,
      openOrders: figures.openOrders,
      unappliedCredit: figures.unappliedCredit,
      newOrderValue: roundMoney(orderValueBase.times(baseToLimit), limitMinor),
      securedPct,
      customerStatus: customer.status,
      blockOverdueDays: company.blockOverdueDays,
    });
  }
}
