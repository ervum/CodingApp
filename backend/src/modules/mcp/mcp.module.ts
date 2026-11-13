import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module.js';
import { GamesModule } from '../games/games.module.js';
import { HumanRequestsModule } from '../human-requests/human-requests.module.js';
import { LanesModule } from '../lanes/lanes.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { MarketModule } from '../market/market.module.js';
import { OrchestratorModule } from '../orchestrator/orchestrator.module.js';
import { PitchesModule } from '../pitches/pitches.module.js';
import { ReviewModule } from '../review/review.module.js';
import { StudiosModule } from '../studios/studios.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { VaultModule } from '../vault/vault.module.js';
import { McpController } from './mcp.controller.js';
import { McpService } from './mcp.service.js';

@Module({
  imports: [
    AgentsModule,
    TasksModule,
    OrchestratorModule,
    LlmModule,
    StudiosModule,
    HumanRequestsModule,
    GamesModule,
    PitchesModule,
    MarketModule,
    VaultModule,
    ReviewModule,
    LanesModule,
  ],
  controllers: [McpController],
  providers: [McpService],
  exports: [McpService],
})
export class McpModule {}
