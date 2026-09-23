import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { DocumentLinesService } from './document-lines.service';

@Module({
  controllers: [CatalogController],
  providers: [CatalogService, DocumentLinesService],
  exports: [CatalogService, DocumentLinesService],
})
export class CatalogModule {}
