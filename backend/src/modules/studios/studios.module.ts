import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module.js';
import { GamesModule } from '../games/games.module.js';
import { HumanRequestsModule } from '../human-requests/human-requests.module.js';
import { LanesModule } from '../lanes/lanes.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { MembersController } from './members.controller.js';
import { MembersService } from './members.service.js';
import { SnapshotService } from './snapshot.service.js';
import { StudiosController } from './studios.controller.js';
import { StudiosService } from './studios.service.js';

@Module({
  imports: [
    GamesModule,
    AgentsModule,
    LanesModule,
    HumanRequestsModule,
    TasksModule,
    LlmModule,
  ],
  controllers: [StudiosController, MembersController],
  providers: [StudiosService, SnapshotService, MembersService],
  exports: [StudiosService, SnapshotService, MembersService],
})
export class StudiosModule {}
