import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  currencySchema,
  exchangeRateSchema,
  paymentTermSchema,
  portSchema,
  updateCompanySchema,
  type AuditLogDto,
  type CompanyDto,
  type CurrencyDto,
  type CurrencyInput,
  type ExchangeRateDto,
  type ExchangeRateInput,
  type LookupsDto,
  type PaymentTermDto,
  type PaymentTermInput,
  type PortDto,
  type PortInput,
  type UpdateCompanyInput,
} from '@fillco/contracts';
import { z } from 'zod';
import { Actor, CurrentActor, RequirePermission } from '../../common/actor';
import { ZodPipe } from '../../common/zod.pipe';
import { SettingsService } from './settings.service';

const versionedTerm = paymentTermSchema.extend({ version: z.number().int().nonnegative() });

@Controller()
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('settings/company')
  company(@CurrentActor() actor: Actor): Promise<CompanyDto> {
    return this.settings.company(actor);
  }

  @Patch('settings/company')
  @RequirePermission('settings.manage')
  updateCompany(
    @CurrentActor() actor: Actor,
    @Body(new ZodPipe(updateCompanySchema)) body: UpdateCompanyInput,
  ): Promise<CompanyDto> {
    return this.settings.updateCompany(actor, body);
  }

  /** Dropdown data for every form (any signed-in user). */
  @Get('lookups')
  lookups(@CurrentActor() actor: Actor): Promise<LookupsDto> {
    return this.settings.lookups(actor);
  }

  @Get('currencies')
  currencies(): Promise<CurrencyDto[]> {
    return this.settings.currencies();
  }

  @Post('currencies')
  @RequirePermission('master_data.manage')
  saveCurrency(
    @CurrentActor() actor: Actor,
    @Body(new ZodPipe(currencySchema)) body: CurrencyInput,
  ): Promise<CurrencyDto> {
    return this.settings.upsertCurrency(actor, body);
  }

  @Get('exchange-rates')
  exchangeRates(
    @Query('currency') currency?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<ExchangeRateDto[]> {
    return this.settings.exchangeRates({ currency: currency?.toUpperCase(), from, to });
  }

  @Post('exchange-rates')
  @RequirePermission('exchange_rate.manage')
  saveRate(
    @CurrentActor() actor: Actor,
    @Body(new ZodPipe(exchangeRateSchema)) body: ExchangeRateInput,
  ): Promise<ExchangeRateDto> {
    return this.settings.saveExchangeRate(actor, body);
  }

  @Get('ports')
  ports(): Promise<PortDto[]> {
    return this.settings.ports();
  }

  @Post('ports')
  @RequirePermission('master_data.manage')
  createPort(@CurrentActor() actor: Actor, @Body(new ZodPipe(portSchema)) body: PortInput): Promise<PortDto> {
    return this.settings.savePort(actor, body);
  }

  @Put('ports/:id')
  @RequirePermission('master_data.manage')
  updatePort(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(portSchema)) body: PortInput,
  ): Promise<PortDto> {
    return this.settings.savePort(actor, body, id);
  }

  @Get('payment-terms')
  paymentTerms(): Promise<PaymentTermDto[]> {
    return this.settings.paymentTerms();
  }

  @Post('payment-terms')
  @RequirePermission('master_data.manage')
  createTerm(
    @CurrentActor() actor: Actor,
    @Body(new ZodPipe(paymentTermSchema)) body: PaymentTermInput,
  ): Promise<PaymentTermDto> {
    return this.settings.savePaymentTerm(actor, body);
  }

  @Put('payment-terms/:id')
  @RequirePermission('master_data.manage')
  updateTerm(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(versionedTerm)) body: PaymentTermInput & { version: number },
  ): Promise<PaymentTermDto> {
    return this.settings.savePaymentTerm(actor, body, id, body.version);
  }

  @Get('audit-logs')
  @RequirePermission('audit.view')
  auditLogs(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('userId') userId?: string,
    @Query('take') take?: string,
  ): Promise<AuditLogDto[]> {
    return this.settings.auditLogs({ entityType, entityId, userId, take: take ? Number(take) : undefined });
  }
}
