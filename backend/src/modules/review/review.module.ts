import { Module } from '@nestjs/common';
import { GamesModule } from '../games/games.module.js';
import { MediaModule } from '../media/media.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { BlockersService } from './blockers.service.js';
import { ReviewController } from './review.controller.js';
import { ReviewService } from './review.service.js';

@Module({
  imports: [MediaModule, TasksModule, GamesModule],
  controllers: [ReviewController],
  providers: [ReviewService, BlockersService],
  exports: [ReviewService, BlockersService],
})
export class ReviewModule {}
