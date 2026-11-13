import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { EnvSchema } from './config/env.schema.js';
import { AgentsModule } from './modules/agents/agents.module.js';
import { AssetsModule } from './modules/assets/assets.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { ChatComposerModule } from './modules/chat-composer/chat-composer.module.js';
import { GamesModule } from './modules/games/games.module.js';
import { HealthController } from './modules/health/health.controller.js';
import { HumanRequestsModule } from './modules/human-requests/human-requests.module.js';
import { LanesModule } from './modules/lanes/lanes.module.js';
import { LlmModule } from './modules/llm/llm.module.js';
import { MarketModule } from './modules/market/market.module.js';
import { McpModule } from './modules/mcp/mcp.module.js';
import { MediaModule } from './modules/media/media.module.js';
import { OrchestratorModule } from './modules/orchestrator/orchestrator.module.js';
import { PitchesModule } from './modules/pitches/pitches.module.js';
import { PlaybooksModule } from './modules/playbooks/playbooks.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { ReviewModule } from './modules/review/review.module.js';
import { SearchModule } from './modules/search/search.module.js';
import { StudiosModule } from './modules/studios/studios.module.js';
import { TasksModule } from './modules/tasks/tasks.module.js';
import { UsageModule } from './modules/usage/usage.module.js';
import { VaultModule } from './modules/vault/vault.module.js';
import { WorkspaceModule } from './modules/workspace/workspace.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (raw) => EnvSchema.parse(raw),
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10_000 }]),
    PrismaModule,
    RealtimeModule,
    AuthModule,
    MediaModule,
    LanesModule,
    LlmModule,
    VaultModule,
    AgentsModule,
    TasksModule,
    GamesModule,
    HumanRequestsModule,
    ReviewModule,
    PitchesModule,
    MarketModule,
    OrchestratorModule,
    StudiosModule,
    SearchModule,
    McpModule,
    WorkspaceModule,
    ChatComposerModule,
    AssetsModule,
    UsageModule,
    PlaybooksModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
