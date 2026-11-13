import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  HistoryQuerySchema,
  LeaderboardQuerySchema,
  type HistoryQuery,
  type LeaderboardQuery,
  type MarketHistoryPointDto,
  type MarketIngestionRunDto,
  type MarketLeaderboardDto,
} from '@robdev/shared';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { MarketService } from './market.service.js';

@Controller('market')
export class MarketController {
  constructor(private readonly market: MarketService) {}

  @Get('leaderboard')
  async leaderboard(
    @Query(new ZodValidationPipe(LeaderboardQuerySchema)) query: LeaderboardQuery,
  ): Promise<MarketLeaderboardDto> {
    return this.market.leaderboard(query);
  }

  @Get('games/:universeId/history')
  async history(
    @Param('universeId') universeId: string,
    @Query(new ZodValidationPipe(HistoryQuerySchema)) query: HistoryQuery,
  ): Promise<MarketHistoryPointDto[]> {
    return this.market.history(universeId, query.days);
  }

  @Get('ingestion-runs')
  async listRuns(@Query('limit') limitRaw?: string): Promise<MarketIngestionRunDto[]> {
    const parsed = limitRaw ? Number.parseInt(limitRaw, 10) : 10;
    const limit = Number.isFinite(parsed) ? parsed : 10;
    return this.market.listIngestionRuns(limit);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.ACCEPTED)
  async refresh(@CurrentUser() user: AuthenticatedUser): Promise<MarketIngestionRunDto> {
    return this.market.triggerRefresh(user.id);
  }
}
