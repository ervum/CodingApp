import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { StudioUsageReportDto } from '@robdev/shared';
import {
  StudioCtx,
  type StudioRequestContext,
} from '../../common/decorators/studio-context.decorator.js';
import { StudioAccessGuard } from '../../common/guards/studio-access.guard.js';
import { UsageService } from './usage.service.js';

@Controller('studios/:studioId/usage')
@UseGuards(StudioAccessGuard)
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get()
  async getOverview(
    @StudioCtx() studio: StudioRequestContext,
    @Query('days') daysRaw?: string,
  ): Promise<StudioUsageReportDto> {
    const parsedDays = daysRaw ? Number.parseInt(daysRaw, 10) : 14;
    const days = Number.isFinite(parsedDays) ? parsedDays : 14;
    return this.usage.getOverview(studio.id, days);
  }
}
