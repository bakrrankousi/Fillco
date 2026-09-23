import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import {
  allocationSchema,
  listQuerySchema,
  milestoneSchema,
  purchaseFromSalesSchema,
  purchaseOrderSchema,
  purchaseOrderTransitionSchema,
  quantity,
  requiredText,
  updatePurchaseOrderSchema,
  type AllocationDto,
  type AllocationInput,
  type MilestoneInput,
  type Page,
  type PurchaseFromSalesInput,
  type PurchaseOrderDto,
  type PurchaseOrderInput,
  type PurchaseOrderListItemDto,
  type PurchaseOrderTransitionInput,
  type UpdatePurchaseOrderInput,
} from '@fillco/contracts';
import type { Response } from 'express';
import { z } from 'zod';
import { Actor, CurrentActor, RequirePermission } from '../../common/actor';
import { MONEY_FMT, sendExcel } from '../../common/list';
import { ZodPipe } from '../../common/zod.pipe';
import { PurchaseOrderFilter, PurchaseOrdersService } from './purchase-orders.service';

const query = listQuerySchema.extend({
  status: z.string().optional(),
  supplierId: z.string().uuid().optional(),
  delayed: z.enum(['true', 'false']).optional(),
});
const updateAllocation = z.object({ qty: quantity, uom: z.string().min(1), reason: requiredText(1000) });

@Controller()
export class PurchaseOrdersController {
  constructor(private readonly orders: PurchaseOrdersService) {}

  @Get('purchase-orders')
  @RequirePermission('purchase_order.view')
  async list(
    @CurrentActor() actor: Actor,
    @Query(new ZodPipe(query)) q: PurchaseOrderFilter,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Page<PurchaseOrderListItemDto> | void> {
    const result = await this.orders.list(actor, q);
    if (q.format !== 'xlsx') return result.page;
    await sendExcel<PurchaseOrderListItemDto>(
      res,
      actor,
      'purchase-orders',
      'Purchase orders',
      [
        { header: 'Number', value: (r) => r.number, width: 16 },
        { header: 'Supplier', value: (r) => r.supplier.name, width: 32 },
        { header: 'Country', value: (r) => r.supplierCountry, width: 8 },
        { header: 'Supplier ref', value: (r) => r.supplierRef },
        { header: 'PO date', value: (r) => r.poDate, numFmt: 'yyyy-mm-dd', width: 12 },
        { header: 'Currency', value: (r) => r.currency, width: 9 },
        { header: 'Total', value: (r) => r.grandTotal, numFmt: MONEY_FMT },
        { header: 'Total (base)', value: (r) => r.grandTotalBase, numFmt: MONEY_FMT },
        { header: 'Status', value: (r) => r.status },
        { header: 'Ready date', value: (r) => r.expectedReadyDate, numFmt: 'yyyy-mm-dd', width: 12 },
        { header: 'Delayed', value: (r) => (r.isDelayed ? 'Yes' : ''), width: 8 },
        { header: 'Allocated %', value: (r) => r.allocatedPct, numFmt: '0.0' },
        { header: 'Sales orders', value: (r) => r.salesOrders.map((s) => s.code).join(', '), width: 30 },
      ],
      result.rows,
    );
  }

  @Get('purchase-orders/open-supply')
  @RequirePermission('purchase_order.view')
  openSupply(
    @CurrentActor() actor: Actor,
    @Query('variantId') variantId?: string,
    @Query('productId') productId?: string,
  ) {
    return this.orders.openSupply(actor, variantId, productId);
  }

  @Get('purchase-orders/:id')
  @RequirePermission('purchase_order.view')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<PurchaseOrderDto> {
    return this.orders.get(actor, id);
  }

  @Post('purchase-orders')
  @RequirePermission('purchase_order.manage')
  create(
    @CurrentActor() actor: Actor,
    @Body(new ZodPipe(purchaseOrderSchema)) body: PurchaseOrderInput,
  ): Promise<PurchaseOrderDto> {
    return this.orders.create(actor, body);
  }

  @Post('purchase-orders/from-sales')
  @RequirePermission('purchase_order.manage')
  fromSales(
    @CurrentActor() actor: Actor,
    @Body(new ZodPipe(purchaseFromSalesSchema)) body: PurchaseFromSalesInput,
  ): Promise<PurchaseOrderDto> {
    return this.orders.purchaseFromSales(actor, body);
  }

  @Put('purchase-orders/:id')
  @RequirePermission('purchase_order.manage')
  update(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updatePurchaseOrderSchema)) body: UpdatePurchaseOrderInput,
  ): Promise<PurchaseOrderDto> {
    return this.orders.update(actor, id, body);
  }

  @Delete('purchase-orders/:id')
  @HttpCode(204)
  @RequirePermission('purchase_order.delete')
  delete(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.orders.delete(actor, id);
  }

  @Post('purchase-orders/:id/transition')
  @RequirePermission('purchase_order.confirm', 'purchase_order.cancel')
  transition(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(purchaseOrderTransitionSchema)) body: PurchaseOrderTransitionInput,
  ): Promise<PurchaseOrderDto> {
    return this.orders.transition(actor, id, body);
  }

  @Put('purchase-orders/:id/milestones')
  @RequirePermission('purchase_order.manage', 'purchase_order.confirm')
  milestone(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(milestoneSchema)) body: MilestoneInput,
  ): Promise<PurchaseOrderDto> {
    return this.orders.saveMilestone(actor, id, body);
  }

  @Post('allocations')
  @RequirePermission('allocation.manage')
  allocate(
    @CurrentActor() actor: Actor,
    @Body(new ZodPipe(allocationSchema)) body: AllocationInput,
  ): Promise<AllocationDto> {
    return this.orders.allocate(actor, body);
  }

  @Patch('allocations/:id')
  @RequirePermission('allocation.manage')
  updateAllocation(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateAllocation)) body: z.infer<typeof updateAllocation>,
  ): Promise<AllocationDto | null> {
    return this.orders.updateAllocation(actor, id, body.qty, body.uom, body.reason);
  }
}
