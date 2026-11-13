import { Module } from '@nestjs/common';
import { GamesModule } from '../games/games.module.js';
import { HumanRequestsModule } from '../human-requests/human-requests.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { PitchesController } from './pitches.controller.js';
import { PitchesService } from './pitches.service.js';

@Module({
  imports: [TasksModule, GamesModule, HumanRequestsModule],
  controllers: [PitchesController],
  providers: [PitchesService],
  exports: [PitchesService],
})
export class PitchesModule {}
