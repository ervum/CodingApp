import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { BuildsService } from './builds.service.js';
import { GamesController } from './games.controller.js';
import { GamesService } from './games.service.js';

@Module({
  imports: [MediaModule, TasksModule],
  controllers: [GamesController],
  providers: [GamesService, BuildsService],
  exports: [GamesService, BuildsService],
})
export class GamesModule {}
