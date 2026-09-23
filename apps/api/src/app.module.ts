import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { CommonModule } from './common/common.module';
import { ProblemFilter } from './common/problem.filter';
import { SessionGuard } from './common/session.guard';
import { HealthController } from './health.controller';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { InsightsModule } from './modules/insights/insights.module';
import { PartiesModule } from './modules/parties/parties.module';
import { PurchasingModule } from './modules/purchasing/purchasing.module';
import { SalesModule } from './modules/sales/sales.module';
import { SettingsModule } from './modules/settings/settings.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    CommonModule,
    AuthModule,
    UsersModule,
    SettingsModule,
    PartiesModule,
    CatalogModule,
    SalesModule,
    PurchasingModule,
    InsightsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_FILTER, useClass: ProblemFilter },
  ],
})
export class AppModule {}
