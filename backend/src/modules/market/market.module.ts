import { Module } from '@nestjs/common';
import { MarketIngestionService } from './market-ingestion.service.js';
import { MarketController } from './market.controller.js';
import { MarketService } from './market.service.js';
import { RobloxClient } from './roblox/roblox-client.js';

@Module({
  controllers: [MarketController],
  providers: [RobloxClient, MarketIngestionService, MarketService],
  exports: [MarketService, MarketIngestionService, RobloxClient],
})
export class MarketModule {}
