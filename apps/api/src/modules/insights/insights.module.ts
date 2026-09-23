import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { InsightsController } from './insights.controller';
import { SearchService } from './search.service';

@Module({ controllers: [InsightsController], providers: [SearchService, DashboardService] })
export class InsightsModule {}
