import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import type { QuickJumpResultDto } from '@robdev/shared';
import { StudioAccessGuard } from '../../common/guards/studio-access.guard.js';
import { SearchService } from './search.service.js';

@Controller('studios/:studioId/search')
@UseGuards(StudioAccessGuard)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  async quickJump(
    @Param('studioId') studioId: string,
    @Query('q') q?: string,
  ): Promise<QuickJumpResultDto[]> {
    return this.search.quickJump(studioId, q ?? '');
  }
}
