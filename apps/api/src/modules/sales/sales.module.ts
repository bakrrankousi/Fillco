import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { PartiesModule } from '../parties/parties.module';
import { QuotationsController } from './quotations.controller';
import { QuotationsService } from './quotations.service';
import { SalesOrdersController } from './sales-orders.controller';
import { SalesOrdersService } from './sales-orders.service';

@Module({
  imports: [CatalogModule, PartiesModule],
  controllers: [QuotationsController, SalesOrdersController],
  providers: [QuotationsService, SalesOrdersService],
  exports: [SalesOrdersService],
})
export class SalesModule {}
