import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import {
  listQuerySchema,
  quotationDecisionSchema,
  quotationSchema,
  updateQuotationSchema,
  type Page,
  type QuotationDto,
  type QuotationInput,
  type QuotationListItemDto,
  type UpdateQuotationInput,
} from '@fillco/contracts';
import type { Response } from 'express';
import { z } from 'zod';
import { Actor, CurrentActor, RequirePermission } from '../../common/actor';
import { MONEY_FMT, sendExcel } from '../../common/list';
import { ZodPipe } from '../../common/zod.pipe';
import { QuotationFilter, QuotationsService } from './quotations.service';

const query = listQuerySchema.extend({ status: z.string().optional(), customerId: z.string().uuid().optional() });

@Controller('quotations')
export class QuotationsController {
  constructor(private readonly quotations: QuotationsService) {}

  @Get()
  @RequirePermission('quotation.view')
  async list(
    @CurrentActor() actor: Actor,
    @Query(new ZodPipe(query)) q: QuotationFilter,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Page<QuotationListItemDto> | void> {
    const result = await this.quotations.list(actor, q);
    if (q.format !== 'xlsx') return result.page;
    await sendExcel<QuotationListItemDto>(res, actor, 'quotations', 'Quotations', [
      { header: 'Number', value: (r) => r.number, width: 16 },
      { header: 'Rev', value: (r) => r.revision, width: 5 },
      { header: 'Customer', value: (r) => r.customer.name, width: 32 },
      { header: 'Date', value: (r) => r.quotationDate, numFmt: 'yyyy-mm-dd', width: 12 },
      { header: 'Valid until', value: (r) => r.validUntil, numFmt: 'yyyy-mm-dd', width: 12 },
      { header: 'Currency', value: (r) => r.currency, width: 9 },
      { header: 'Total', value: (r) => r.grandTotal, numFmt: MONEY_FMT },
      { header: 'Status', value: (r) => (r.isExpired ? 'EXPIRED' : r.status) },
      { header: 'Salesperson', value: (r) => r.salesperson, width: 22 },
    ], result.rows);
  }

  @Get(':id')
  @RequirePermission('quotation.view')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<QuotationDto> {
    return this.quotations.get(actor, id);
  }

  @Post()
  @RequirePermission('quotation.manage')
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(quotationSchema)) body: QuotationInput): Promise<QuotationDto> {
    return this.quotations.create(actor, body);
  }

  @Put(':id')
  @RequirePermission('quotation.manage')
  update(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateQuotationSchema)) body: UpdateQuotationInput,
  ): Promise<QuotationDto> {
    return this.quotations.update(actor, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('quotation.delete')
  delete(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.quotations.delete(actor, id);
  }

  @Post(':id/send')
  @RequirePermission('quotation.manage')
  send(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<QuotationDto> {
    return this.quotations.send(actor, id);
  }

  @Post(':id/accept')
  @RequirePermission('quotation.manage')
  accept(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(quotationDecisionSchema)) body: { note?: string | null },
  ): Promise<QuotationDto> {
    return this.quotations.accept(actor, id, body.note);
  }

  @Post(':id/reject')
  @RequirePermission('quotation.manage')
  reject(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(quotationDecisionSchema)) body: { note?: string | null },
  ): Promise<QuotationDto> {
    return this.quotations.reject(actor, id, body.note);
  }

  @Post(':id/revise')
  @RequirePermission('quotation.manage')
  revise(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<QuotationDto> {
    return this.quotations.revise(actor, id);
  }

  @Post(':id/convert')
  @RequirePermission('sales_order.manage')
  convert(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<{ salesOrderId: string }> {
    return this.quotations.convert(actor, id);
  }
}
