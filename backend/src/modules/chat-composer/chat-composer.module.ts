import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { OrchestratorModule } from '../orchestrator/orchestrator.module.js';
import { ChatComposerController } from './chat-composer.controller.js';
import { ChatComposerService } from './chat-composer.service.js';

@Module({
  imports: [MediaModule, OrchestratorModule],
  controllers: [ChatComposerController],
  providers: [ChatComposerService],
  exports: [ChatComposerService],
})
export class ChatComposerModule {}
