import { Module } from '@nestjs/common';
import { LanesController } from './lanes.controller.js';
import { LanesService } from './lanes.service.js';

@Module({
  controllers: [LanesController],
  providers: [LanesService],
  exports: [LanesService],
})
export class LanesModule {}
