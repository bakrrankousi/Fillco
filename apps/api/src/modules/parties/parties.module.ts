import { Module } from '@nestjs/common';
import { CreditService } from './credit.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';

@Module({
  controllers: [CustomersController, SuppliersController],
  providers: [CustomersService, SuppliersService, CreditService],
  exports: [CustomersService, SuppliersService, CreditService],
})
export class PartiesModule {}
