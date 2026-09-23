import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import {
  attributeDefinitionSchema,
  categoryAttributesSchema,
  categorySchema,
  listQuerySchema,
  productSchema,
  specInput,
  updateProductSchema,
  type AttributeDefinitionDto,
  type AttributeDefinitionInput,
  type CategoryAttributesInput,
  type CategoryDto,
  type CategoryInput,
  type Page,
  type ProductDto,
  type ProductInput,
  type ProductListItemDto,
  type UpdateProductInput,
  type VariantDto,
} from '@fillco/contracts';
import type { Response } from 'express';
import { z } from 'zod';
import { Actor, CurrentActor, RequirePermission } from '../../common/actor';
import { sendExcel } from '../../common/list';
import { ZodPipe } from '../../common/zod.pipe';
import { CatalogService, ProductFilter } from './catalog.service';

const productQuery = listQuerySchema.extend({
  categoryId: z.string().uuid().optional(),
  active: z.enum(['true', 'false']).optional(),
});

@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('catalog/categories')
  @RequirePermission('product.view')
  categories(): Promise<CategoryDto[]> {
    return this.catalog.categories();
  }

  @Post('catalog/categories')
  @RequirePermission('catalog.manage')
  createCategory(
    @CurrentActor() actor: Actor,
    @Body(new ZodPipe(categorySchema)) body: CategoryInput,
  ): Promise<CategoryDto[]> {
    return this.catalog.saveCategory(actor, body);
  }

  @Patch('catalog/categories/:id')
  @RequirePermission('catalog.manage')
  updateCategory(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(categorySchema)) body: CategoryInput,
  ): Promise<CategoryDto[]> {
    return this.catalog.saveCategory(actor, body, id);
  }

  @Put('catalog/categories/:id/attributes')
  @RequirePermission('catalog.manage')
  setAttributes(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(categoryAttributesSchema)) body: CategoryAttributesInput,
  ): Promise<CategoryDto[]> {
    return this.catalog.setCategoryAttributes(actor, id, body);
  }

  @Get('catalog/attributes')
  @RequirePermission('product.view')
  attributes(): Promise<AttributeDefinitionDto[]> {
    return this.catalog.attributes();
  }

  @Post('catalog/attributes')
  @RequirePermission('catalog.manage')
  createAttribute(
    @CurrentActor() actor: Actor,
    @Body(new ZodPipe(attributeDefinitionSchema)) body: AttributeDefinitionInput,
  ): Promise<AttributeDefinitionDto> {
    return this.catalog.saveAttribute(actor, body);
  }

  @Patch('catalog/attributes/:id')
  @RequirePermission('catalog.manage')
  updateAttribute(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(attributeDefinitionSchema)) body: AttributeDefinitionInput,
  ): Promise<AttributeDefinitionDto> {
    return this.catalog.saveAttribute(actor, body, id);
  }

  @Get('products')
  @RequirePermission('product.view')
  async products(
    @CurrentActor() actor: Actor,
    @Query(new ZodPipe(productQuery)) q: ProductFilter,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Page<ProductListItemDto> | void> {
    const result = await this.catalog.listProducts(q);
    if (q.format !== 'xlsx') return result.page;
    await sendExcel<ProductListItemDto>(
      res,
      actor,
      'products',
      'Products',
      [
        { header: 'Code', value: (r) => r.code, width: 16 },
        { header: 'Name', value: (r) => r.name, width: 32 },
        { header: 'Category', value: (r) => r.categoryPath, width: 36 },
        { header: 'Sales unit', value: (r) => r.defaultSalesUom, width: 10 },
        { header: 'HS code', value: (r) => r.hsCode, width: 12 },
        { header: 'Origin', value: (r) => r.countryOfOrigin, width: 8 },
        { header: 'Variants', value: (r) => r.variantCount, width: 10 },
        { header: 'Active', value: (r) => (r.isActive ? 'Yes' : 'No'), width: 8 },
      ],
      result.rows,
    );
  }

  @Get('products/:id')
  @RequirePermission('product.view')
  product(@Param('id', ParseUUIDPipe) id: string): Promise<ProductDto> {
    return this.catalog.getProduct(id);
  }

  @Post('products')
  @RequirePermission('product.manage')
  createProduct(
    @CurrentActor() actor: Actor,
    @Body(new ZodPipe(productSchema)) body: ProductInput,
  ): Promise<ProductDto> {
    return this.catalog.createProduct(actor, body);
  }

  @Patch('products/:id')
  @RequirePermission('product.manage')
  updateProduct(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateProductSchema)) body: UpdateProductInput,
  ): Promise<ProductDto> {
    return this.catalog.updateProduct(actor, id, body);
  }

  /** Finds or creates the variant for a specification (used while entering document lines). */
  @Post('products/:id/variants')
  @RequirePermission('product.manage', 'quotation.manage', 'sales_order.manage', 'purchase_order.manage')
  resolveVariant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(z.object({ attributes: specInput }))) body: { attributes: Record<string, unknown> },
  ): Promise<VariantDto> {
    return this.catalog.resolveVariantDto(id, body.attributes);
  }
}
