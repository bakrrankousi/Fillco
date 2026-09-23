import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { CompanyService } from './company.service';
import { FxService } from './fx.service';
import { PrismaService } from './prisma.service';
import { SequenceService } from './sequence.service';

@Global()
@Module({
  providers: [PrismaService, AuditService, SequenceService, FxService, CompanyService],
  exports: [PrismaService, AuditService, SequenceService, FxService, CompanyService],
})
export class CommonModule {}
