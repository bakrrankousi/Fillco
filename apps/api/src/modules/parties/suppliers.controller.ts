import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import {
  addressSchema,
  bankAccountSchema,
  contactSchema,
  createSupplierSchema,
  listQuerySchema,
  reasonSchema,
  updateSupplierSchema,
  type AddressInput,
  type BankAccountInput,
  type ContactInput,
  type CreateSupplierInput,
  type Page,
  type ReasonInput,
  type SupplierDto,
  type SupplierListItemDto,
  type UpdateSupplierInput,
} from '@fillco/contracts';
import type { Response } from 'express';
import { z } from 'zod';
import { Actor, CurrentActor, RequirePermission } from '../../common/actor';
import { sendExcel } from '../../common/list';
import { ZodPipe } from '../../common/zod.pipe';
import { SupplierFilter, SuppliersService } from './suppliers.service';

const supplierQuery = listQuerySchema.extend({
  status: z.string().optional(),
  supplierType: z.string().optional(),
  countryCode: z.string().optional(),
});

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @RequirePermission('supplier.view')
  async list(
    @CurrentActor() actor: Actor,
    @Query(new ZodPipe(supplierQuery)) q: SupplierFilter,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Page<SupplierListItemDto> | void> {
    const result = await this.suppliers.list(actor, q);
    if (q.format !== 'xlsx') return result.page;
    await sendExcel<SupplierListItemDto>(res, actor, 'suppliers', 'Suppliers', [
      { header: 'Code', value: (r) => r.code, width: 10 },
      { header: 'Company', value: (r) => r.companyName, width: 36 },
      { header: 'Type', value: (r) => r.supplierType, width: 16 },
      { header: 'Country', value: (r) => r.countryCode, width: 8 },
      { header: 'City', value: (r) => r.city },
      { header: 'Status', value: (r) => r.status },
      { header: 'Currency', value: (r) => r.defaultCurrency, width: 9 },
      { header: 'Payment terms', value: (r) => r.paymentTerm, width: 30 },
      { header: 'Lead time (days)', value: (r) => r.productionLeadTimeDays },
      { header: 'Phone', value: (r) => r.phone, width: 18 },
      { header: 'Email', value: (r) => r.email, width: 28 },
    ], result.rows);
  }

  @Get(':id')
  @RequirePermission('supplier.view')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<SupplierDto> {
    return this.suppliers.get(actor, id);
  }

  @Post()
  @RequirePermission('supplier.create')
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(createSupplierSchema)) body: CreateSupplierInput): Promise<SupplierDto> {
    return this.suppliers.create(actor, body);
  }

  @Patch(':id')
  @RequirePermission('supplier.edit', 'supplier.archive')
  update(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateSupplierSchema)) body: UpdateSupplierInput,
  ): Promise<SupplierDto> {
    return this.suppliers.update(actor, id, body);
  }

  @Post(':id/contacts')
  @RequirePermission('supplier.edit')
  addContact(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(contactSchema)) body: ContactInput,
  ): Promise<SupplierDto> {
    return this.suppliers.addContact(actor, id, body);
  }

  @Put(':id/contacts/:contactId')
  @RequirePermission('supplier.edit')
  updateContact(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Body(new ZodPipe(contactSchema)) body: ContactInput,
  ): Promise<SupplierDto> {
    return this.suppliers.updateContact(actor, id, contactId, body);
  }

  @Delete(':id/contacts/:contactId')
  @RequirePermission('supplier.edit')
  deleteContact(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
  ): Promise<SupplierDto> {
    return this.suppliers.deleteContact(actor, id, contactId);
  }

  @Post(':id/addresses')
  @RequirePermission('supplier.edit')
  addAddress(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(addressSchema)) body: AddressInput,
  ): Promise<SupplierDto> {
    return this.suppliers.addAddress(actor, id, body);
  }

  @Delete(':id/addresses/:addressId')
  @RequirePermission('supplier.edit')
  deleteAddress(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('addressId', ParseUUIDPipe) addressId: string,
  ): Promise<SupplierDto> {
    return this.suppliers.deleteAddress(actor, id, addressId);
  }

  @Post(':id/bank-accounts')
  @RequirePermission('supplier_bank.manage')
  addBankAccount(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(bankAccountSchema)) body: BankAccountInput,
  ): Promise<SupplierDto> {
    return this.suppliers.addBankAccount(actor, id, body);
  }

  @Post(':id/bank-accounts/:accountId/approve')
  @RequirePermission('supplier_bank.approve')
  approve(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ): Promise<SupplierDto> {
    return this.suppliers.approveBankAccount(actor, id, accountId);
  }

  @Post(':id/bank-accounts/:accountId/revoke')
  @RequirePermission('supplier_bank.manage')
  revoke(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body(new ZodPipe(reasonSchema)) body: ReasonInput,
  ): Promise<SupplierDto> {
    return this.suppliers.revokeBankAccount(actor, id, accountId, body.reason);
  }
}
