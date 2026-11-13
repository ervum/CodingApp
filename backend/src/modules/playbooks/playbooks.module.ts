import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module.js';
import { PlaybooksController } from './playbooks.controller.js';
import { PlaybooksService } from './playbooks.service.js';

@Module({
  imports: [TasksModule],
  controllers: [PlaybooksController],
  providers: [PlaybooksService],
  exports: [PlaybooksService],
})
export class PlaybooksModule {}
