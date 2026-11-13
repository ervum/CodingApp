import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module.js';
import { HumanRequestsController } from './human-requests.controller.js';
import { HumanRequestsService } from './human-requests.service.js';

@Module({
  imports: [TasksModule],
  controllers: [HumanRequestsController],
  providers: [HumanRequestsService],
  exports: [HumanRequestsService],
})
export class HumanRequestsModule {}
