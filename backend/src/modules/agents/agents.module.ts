import { forwardRef, Module } from '@nestjs/common';
import { LanesModule } from '../lanes/lanes.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { AgentMessagesService } from './agent-messages.service.js';
import { AgentsController } from './agents.controller.js';
import { AgentsService } from './agents.service.js';
import { ChatHistoryService } from './chat-history.service.js';

@Module({
  imports: [LanesModule, LlmModule, forwardRef(() => TasksModule)],
  controllers: [AgentsController],
  providers: [AgentsService, AgentMessagesService, ChatHistoryService],
  exports: [AgentsService, AgentMessagesService, ChatHistoryService],
})
export class AgentsModule {}
