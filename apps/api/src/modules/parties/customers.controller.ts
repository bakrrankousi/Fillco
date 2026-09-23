import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import {
  addressSchema,
  contactSchema,
  createCustomerSchema,
  listQuerySchema,
  updateCustomerSchema,
  type AddressInput,
  type ContactInput,
  type CreateCustomerInput,
  type CreditExposureDto,
  type CustomerDto,
  type CustomerListItemDto,
  type Page,
  type UpdateCustomerInput,
} from '@fillco/contracts';
import type { Response } from 'express';
import { z } from 'zod';
import { Actor, CurrentActor, RequirePermission } from '../../common/actor';
import { MONEY_FMT, sendExcel } from '../../common/list';
import { ZodPipe } from '../../common/zod.pipe';
import { CustomerFilter, CustomersService } from './customers.service';

const customerQuery = listQuerySchema.extend({
  status: z.string().optional(),
  countryCode: z.string().optional(),
  salespersonId: z.string().uuid().optional(),
});

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermission('customer.view')
  async list(
    @CurrentActor() actor: Actor,
    @Query(new ZodPipe(customerQuery)) q: CustomerFilter,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Page<CustomerListItemDto> | void> {
    const result = await this.customers.list(actor, q);
    if (q.format !== 'xlsx') return result.page;
    await sendExcel<CustomerListItemDto>(res, actor, 'customers', 'Customers', [
      { header: 'Code', value: (r) => r.code, width: 10 },
      { header: 'Company', value: (r) => r.companyName, width: 36 },
      { header: 'Country', value: (r) => r.countryCode, width: 8 },
      { header: 'City', value: (r) => r.city },
      { header: 'Status', value: (r) => r.status },
      { header: 'Currency', value: (r) => r.defaultCurrency, width: 9 },
      { header: 'Payment terms', value: (r) => r.paymentTerm, width: 30 },
      { header: 'Credit limit', value: (r) => r.creditLimit, numFmt: MONEY_FMT },
      { header: 'Limit currency', value: (r) => r.creditLimitCurrency, width: 9 },
      { header: 'Salesperson', value: (r) => r.salesperson, width: 22 },
      { header: 'Phone', value: (r) => r.phone, width: 18 },
      { header: 'Email', value: (r) => r.email, width: 28 },
    ], result.rows);
  }

  @Get(':id')
  @RequirePermission('customer.view')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<CustomerDto> {
    return this.customers.get(actor, id);
  }

  @Get(':id/exposure')
  @RequirePermission('customer.view')
  exposure(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<CreditExposureDto> {
    return this.customers.exposure(actor, id);
  }

  @Post()
  @RequirePermission('customer.create')
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(createCustomerSchema)) body: CreateCustomerInput): Promise<CustomerDto> {
    return this.customers.create(actor, body);
  }

  @Patch(':id')
  @RequirePermission('customer.edit', 'customer.credit_limit.edit', 'customer.archive')
  update(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateCustomerSchema)) body: UpdateCustomerInput,
  ): Promise<CustomerDto> {
    return this.customers.update(actor, id, body);
  }

  @Post(':id/contacts')
  @RequirePermission('customer.edit')
  addContact(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(contactSchema)) body: ContactInput,
  ): Promise<CustomerDto> {
    return this.customers.addContact(actor, id, body);
  }

  @Put(':id/contacts/:contactId')
  @RequirePermission('customer.edit')
  updateContact(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Body(new ZodPipe(contactSchema)) body: ContactInput,
  ): Promise<CustomerDto> {
    return this.customers.updateContact(actor, id, contactId, body);
  }

  @Delete(':id/contacts/:contactId')
  @RequirePermission('customer.edit')
  deleteContact(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
  ): Promise<CustomerDto> {
    return this.customers.deleteContact(actor, id, contactId);
  }

  @Post(':id/addresses')
  @RequirePermission('customer.edit')
  addAddress(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(addressSchema)) body: AddressInput,
  ): Promise<CustomerDto> {
    return this.customers.addAddress(actor, id, body);
  }

  @Put(':id/addresses/:addressId')
  @RequirePermission('customer.edit')
  updateAddress(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('addressId', ParseUUIDPipe) addressId: string,
    @Body(new ZodPipe(addressSchema)) body: AddressInput,
  ): Promise<CustomerDto> {
    return this.customers.updateAddress(actor, id, addressId, body);
  }

  @Delete(':id/addresses/:addressId')
  @RequirePermission('customer.edit')
  deleteAddress(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('addressId', ParseUUIDPipe) addressId: string,
  ): Promise<CustomerDto> {
    return this.customers.deleteAddress(actor, id, addressId);
  }
}
