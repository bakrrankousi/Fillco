import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import {
  closeLineSchema,
  confirmSalesOrderSchema,
  listQuerySchema,
  requiredText,
  salesOrderSchema,
  updateSalesOrderSchema,
  type AwaitingPurchaseItemDto,
  type ConfirmSalesOrderInput,
  type CreditPreviewDto,
  type Page,
  type SalesOrderDto,
  type SalesOrderInput,
  type SalesOrderListItemDto,
  type UpdateSalesOrderInput,
} from '@fillco/contracts';
import { SO_DISPLAY_STATUS_LABELS } from '@fillco/domain';
import type { Response } from 'express';
import { z } from 'zod';
import { Actor, CurrentActor, RequirePermission } from '../../common/actor';
import { MONEY_FMT, QTY_FMT, sendExcel } from '../../common/list';
import { ZodPipe } from '../../common/zod.pipe';
import { SalesOrderFilter, SalesOrdersService } from './sales-orders.service';

const query = listQuerySchema.extend({
  status: z.string().optional(),
  customerId: z.string().uuid().optional(),
  salespersonId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});
const awaitingQuery = listQuerySchema.extend({
  customerId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
});
const versionOnly = z.object({ version: z.number().int().nonnegative() });
const versionReason = z.object({ version: z.number().int().nonnegative(), reason: requiredText(1000) });

@Controller('sales-orders')
export class SalesOrdersController {
  constructor(private readonly orders: SalesOrdersService) {}

  @Get()
  @RequirePermission('sales_order.view')
  async list(
    @CurrentActor() actor: Actor,
    @Query(new ZodPipe(query)) q: SalesOrderFilter,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Page<SalesOrderListItemDto> | void> {
    const result = await this.orders.list(actor, q);
    if (q.format !== 'xlsx') return result.page;
    await sendExcel<SalesOrderListItemDto>(
      res,
      actor,
      'sales-orders',
      'Sales orders',
      [
        { header: 'Number', value: (r) => r.number, width: 16 },
        { header: 'Customer', value: (r) => r.customer.name, width: 32 },
        { header: 'Country', value: (r) => r.customerCountry, width: 8 },
        { header: 'Customer PO', value: (r) => r.customerPoRef },
        { header: 'Order date', value: (r) => r.orderDate, numFmt: 'yyyy-mm-dd', width: 12 },
        { header: 'Currency', value: (r) => r.currency, width: 9 },
        { header: 'Total', value: (r) => r.grandTotal, numFmt: MONEY_FMT },
        { header: 'Total (base)', value: (r) => r.grandTotalBase, numFmt: MONEY_FMT },
        { header: 'Status', value: (r) => SO_DISPLAY_STATUS_LABELS[r.displayStatus], width: 26 },
        { header: 'Purchased %', value: (r) => r.purchasedPct, numFmt: '0.0' },
        {
          header: 'Requested shipment',
          value: (r) => r.requestedShipmentDate,
          numFmt: 'yyyy-mm-dd',
          width: 14,
        },
        { header: 'Salesperson', value: (r) => r.salesperson, width: 22 },
      ],
      result.rows,
    );
  }

  @Get('awaiting-purchase')
  @RequirePermission('sales_order.view')
  async awaiting(
    @CurrentActor() actor: Actor,
    @Query(new ZodPipe(awaitingQuery)) q: z.infer<typeof awaitingQuery>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AwaitingPurchaseItemDto[] | void> {
    const rows = await this.orders.awaitingPurchase(actor, q);
    if (q.format !== 'xlsx') return rows;
    await sendExcel<AwaitingPurchaseItemDto>(
      res,
      actor,
      'awaiting-purchase',
      'Awaiting purchase',
      [
        { header: 'Sales order', value: (r) => r.salesOrder.code, width: 16 },
        { header: 'Customer', value: (r) => r.customer.name, width: 30 },
        { header: 'Line', value: (r) => r.lineNo, width: 6 },
        { header: 'Product', value: (r) => r.description, width: 40 },
        { header: 'Ordered (kg)', value: (r) => r.orderedQtyBase, numFmt: QTY_FMT },
        { header: 'Purchased (kg)', value: (r) => r.purchasedQtyBase, numFmt: QTY_FMT },
        { header: 'Remaining (kg)', value: (r) => r.remainingQtyBase, numFmt: QTY_FMT },
        { header: 'Days since confirmation', value: (r) => r.daysSinceConfirmation },
        {
          header: 'Requested shipment',
          value: (r) => r.requestedShipmentDate,
          numFmt: 'yyyy-mm-dd',
          width: 14,
        },
      ],
      rows,
    );
  }

  @Get(':id')
  @RequirePermission('sales_order.view')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<SalesOrderDto> {
    return this.orders.get(actor, id);
  }

  @Get(':id/credit-check')
  @RequirePermission('sales_order.view')
  creditPreview(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CreditPreviewDto> {
    return this.orders.creditPreview(actor, id);
  }

  @Post()
  @RequirePermission('sales_order.manage')
  create(
    @CurrentActor() actor: Actor,
    @Body(new ZodPipe(salesOrderSchema)) body: SalesOrderInput,
  ): Promise<SalesOrderDto> {
    return this.orders.create(actor, body);
  }

  @Put(':id')
  @RequirePermission('sales_order.manage')
  update(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateSalesOrderSchema)) body: UpdateSalesOrderInput,
  ): Promise<SalesOrderDto> {
    return this.orders.update(actor, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('sales_order.delete')
  delete(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.orders.delete(actor, id);
  }

  @Post(':id/submit')
  @RequirePermission('sales_order.manage')
  submit(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(versionOnly)) body: { version: number },
  ): Promise<SalesOrderDto> {
    return this.orders.submit(actor, id, body.version);
  }

  @Post(':id/confirm')
  @RequirePermission('sales_order.confirm', 'credit.override', 'credit.override_block')
  confirm(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(confirmSalesOrderSchema)) body: ConfirmSalesOrderInput,
  ): Promise<SalesOrderDto> {
    return this.orders.confirm(actor, id, body);
  }

  @Post(':id/hold')
  @RequirePermission('sales_order.cancel')
  hold(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(versionReason)) body: { version: number; reason: string },
  ): Promise<SalesOrderDto> {
    return this.orders.hold(actor, id, body.version, body.reason);
  }

  @Post(':id/release')
  @RequirePermission('sales_order.cancel')
  release(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(versionReason)) body: { version: number; reason: string },
  ): Promise<SalesOrderDto> {
    return this.orders.release(actor, id, body.version, body.reason);
  }

  @Post(':id/reopen')
  @RequirePermission('sales_order.cancel')
  reopen(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(versionReason)) body: { version: number; reason: string },
  ): Promise<SalesOrderDto> {
    return this.orders.reopen(actor, id, body.version, body.reason);
  }

  @Post(':id/cancel')
  @RequirePermission('sales_order.cancel')
  cancel(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(versionReason)) body: { version: number; reason: string },
  ): Promise<SalesOrderDto> {
    return this.orders.cancel(actor, id, body.version, body.reason);
  }

  @Post(':id/lines/:lineId/close-short')
  @RequirePermission('sales_order.cancel')
  closeShort(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body(new ZodPipe(closeLineSchema)) body: { reason: string },
  ): Promise<SalesOrderDto> {
    return this.orders.closeLine(actor, id, lineId, 'CLOSED_SHORT', body.reason);
  }

  @Post(':id/lines/:lineId/cancel')
  @RequirePermission('sales_order.cancel')
  cancelLine(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body(new ZodPipe(closeLineSchema)) body: { reason: string },
  ): Promise<SalesOrderDto> {
    return this.orders.closeLine(actor, id, lineId, 'CANCELLED', body.reason);
  }
}
