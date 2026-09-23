import { Controller, Get, Query } from '@nestjs/common';
import type { DashboardDto, SearchResultDto } from '@fillco/contracts';
import { Actor, CurrentActor } from '../../common/actor';
import { DashboardService } from './dashboard.service';
import { SearchService } from './search.service';

@Controller()
export class InsightsController {
  constructor(
    private readonly searchService: SearchService,
    private readonly dashboard: DashboardService,
  ) {}

  @Get('search')
  search(@CurrentActor() actor: Actor, @Query('q') q = ''): Promise<SearchResultDto[]> {
    return this.searchService.search(actor, q.slice(0, 100));
  }

  @Get('dashboard')
  get(@CurrentActor() actor: Actor): Promise<DashboardDto> {
    return this.dashboard.get(actor);
  }
}
