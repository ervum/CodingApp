import { Global, Module } from '@nestjs/common';
import { AgentStatusService } from '../agents/agent-status.service.js';
import { RunRegistryService } from '../orchestrator/run-registry.service.js';
import { RealtimeService } from './realtime.service.js';
import { StudioGateway } from './studio.gateway.js';

@Global()
@Module({
  providers: [StudioGateway, RealtimeService, RunRegistryService, AgentStatusService],
  exports: [StudioGateway, RealtimeService, RunRegistryService, AgentStatusService],
})
export class RealtimeModule {}
