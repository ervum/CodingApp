import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  AgentKey,
  type ChatAttachment,
  type ChatMentionItemDto,
} from '@robdev/shared';
import {
  StudioCtx,
  type StudioRequestContext,
} from '../../common/decorators/studio-context.decorator.js';
import { StudioRoles } from '../../common/decorators/studio-roles.decorator.js';
import { StudioAccessGuard } from '../../common/guards/studio-access.guard.js';
import {
  ChatComposerService,
  type UploadChatFilesInput,
} from './chat-composer.service.js';

@Controller('studios/:studioId/chat')
@UseGuards(StudioAccessGuard)
export class ChatComposerController {
  constructor(private readonly composer: ChatComposerService) {}

  @Get('mentions')
  async listMentions(
    @StudioCtx() studio: StudioRequestContext,
    @Query('q') q?: string,
    @Query('agentKey') agentKeyRaw?: string,
  ): Promise<ChatMentionItemDto[]> {
    const agentKey =
      agentKeyRaw && agentKeyRaw in AgentKey
        ? (agentKeyRaw as AgentKey)
        : undefined;
    return this.composer.listMentions(studio.id, q ?? '', agentKey);
  }

  @Post('uploads')
  @StudioRoles('PRODUCER')
  @HttpCode(HttpStatus.OK)
  async uploadFiles(
    @StudioCtx() studio: StudioRequestContext,
    @Body() body: UploadChatFilesInput,
  ): Promise<{ attachments: ChatAttachment[] }> {
    return this.composer.uploadFiles(studio.id, body);
  }

  @Post('pick-folder')
  @StudioRoles('PRODUCER')
  @HttpCode(HttpStatus.OK)
  async pickFolder(): Promise<{
    attachment: ChatAttachment | null;
    cancelled: boolean;
  }> {
    return this.composer.pickLocalFolder();
  }

  @Post('screenshot')
  @StudioRoles('PRODUCER')
  @HttpCode(HttpStatus.OK)
  async captureScreenshot(
    @StudioCtx() studio: StudioRequestContext,
    @Body() body?: { windowTitle?: string },
  ): Promise<{ attachment: ChatAttachment }> {
    return this.composer.captureScreenshotAttachment(
      studio.id,
      body?.windowTitle,
    );
  }
}
