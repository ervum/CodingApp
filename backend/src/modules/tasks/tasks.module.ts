import { forwardRef, Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module.js';
import { LanesModule } from '../lanes/lanes.module.js';
import { LeadController } from './lead.controller.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

@Module({
  imports: [LanesModule, forwardRef(() => AgentsModule)],
  controllers: [TasksController, LeadController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
