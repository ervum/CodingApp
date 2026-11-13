import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  AgentKey,
  CreateLlmConnectionSchema,
  PullLocalModelSchema,
  RunpodPodActionSchema,
  SetBrowserVisibilitySchema,
  UpdateLlmConnectionSchema,
  type BrowserSessionStatusDto,
  type BrowserVisibilityStatusDto,
  type CreateLlmConnectionRequest,
  type DeleteWebChatsResultDto,
  type DetectedLocalRuntimeDto,
  type DetectedLocalServerDto,
  type LlmConnectionDto,
  type LlmModelInfoDto,
  type PullLocalModelRequest,
  type RunpodPodActionRequest,
  type RunpodPodStatusDto,
  type SetBrowserVisibilityRequest,
  type TestConnectionResultDto,
  type UpdateLlmConnectionRequest,
  type WebChatSessionDto,
} from '@robdev/shared';
import {
  StudioCtx,
  type StudioRequestContext,
} from '../../common/decorators/studio-context.decorator.js';
import { StudioRoles } from '../../common/decorators/studio-roles.decorator.js';
import { AppError } from '../../common/errors/app-error.js';
import { StudioAccessGuard } from '../../common/guards/studio-access.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { LlmConnectionsService } from './llm-connections.service.js';

function parseOptionalAgentKey(raw?: string): AgentKey | undefined {
  if (!raw) return undefined;
  if (!(raw in AgentKey)) {
    throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, `Unknown agent key: ${raw}`);
  }
  return raw as AgentKey;
}

@Controller('studios/:studioId/llm/connections')
@UseGuards(StudioAccessGuard)
@StudioRoles('ADMIN')
export class LlmConnectionsController {
  constructor(private readonly llm: LlmConnectionsService) {}

  @Get()
  async list(@StudioCtx() studio: StudioRequestContext): Promise<LlmConnectionDto[]> {
    return this.llm.list(studio.id);
  }

  @Get('local-detect')
  async detectLocal(): Promise<DetectedLocalServerDto[]> {
    return this.llm.detectLocalServers();
  }

  @Get('local-runtimes')
  async detectLocalRuntimes(
    @Query('refresh') refresh?: string,
  ): Promise<DetectedLocalRuntimeDto[]> {
    return this.llm.detectLocalRuntimes(refresh === 'true');
  }

  @Get('browser-visibility')
  @StudioRoles('PRODUCER')
  async getBrowserVisibility(
    @StudioCtx() studio: StudioRequestContext,
  ): Promise<BrowserVisibilityStatusDto> {
    return this.llm.getBrowserVisibility(studio.id);
  }

  @Post('browser-visibility')
  @StudioRoles('PRODUCER')
  @HttpCode(HttpStatus.OK)
  async setBrowserVisibility(
    @StudioCtx() studio: StudioRequestContext,
    @Body(new ZodValidationPipe(SetBrowserVisibilitySchema))
    body: SetBrowserVisibilityRequest,
  ): Promise<BrowserVisibilityStatusDto> {
    return this.llm.setBrowserVisibility(studio.id, body.visible);
  }

  @Post('answer-now')
  @StudioRoles('PRODUCER')
  @HttpCode(HttpStatus.OK)
  async answerNow(
    @StudioCtx() studio: StudioRequestContext,
    @Body() body?: { runId?: string; agentKey?: string },
  ): Promise<{ ok: boolean; message: string }> {
    return this.llm.triggerAnswerNow(studio.id, {
      runId: body?.runId || undefined,
      agentKey: parseOptionalAgentKey(body?.agentKey),
    });
  }

  @Get('web-chats')
  @StudioRoles('PRODUCER')
  async listWebChats(
    @StudioCtx() studio: StudioRequestContext,
    @Query('agentKey') agentKeyRaw?: string,
  ): Promise<WebChatSessionDto[]> {
    return this.llm.listWebChats(studio.id, parseOptionalAgentKey(agentKeyRaw));
  }

  @Delete('web-chats/last-run')
  @StudioRoles('PRODUCER')
  async deleteLastRunWebChats(
    @StudioCtx() studio: StudioRequestContext,
  ): Promise<DeleteWebChatsResultDto> {
    return this.llm.deleteLastRunWebChats(studio.id);
  }

  @Delete('web-chats/agent/:agentKey')
  @StudioRoles('PRODUCER')
  async deleteAgentWebChats(
    @StudioCtx() studio: StudioRequestContext,
    @Param('agentKey') agentKeyRaw: string,
  ): Promise<DeleteWebChatsResultDto> {
    const key = parseOptionalAgentKey(agentKeyRaw);
    if (!key) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Agent key required');
    }
    return this.llm.deleteAgentWebChats(studio.id, key);
  }

  @Delete('web-chats/:chatId')
  @StudioRoles('PRODUCER')
  async deleteSingleWebChat(
    @StudioCtx() studio: StudioRequestContext,
    @Param('chatId') chatId: string,
  ): Promise<DeleteWebChatsResultDto> {
    return this.llm.deleteSingleWebChat(studio.id, chatId);
  }

  @Post()
  async create(
    @StudioCtx() studio: StudioRequestContext,
    @Body(new ZodValidationPipe(CreateLlmConnectionSchema)) body: CreateLlmConnectionRequest,
  ): Promise<LlmConnectionDto> {
    return this.llm.create(studio.id, body);
  }

  @Patch(':id')
  async update(
    @StudioCtx() studio: StudioRequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateLlmConnectionSchema)) body: UpdateLlmConnectionRequest,
  ): Promise<LlmConnectionDto> {
    return this.llm.update(studio.id, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @StudioCtx() studio: StudioRequestContext,
    @Param('id') id: string,
  ): Promise<void> {
    await this.llm.delete(studio.id, id);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  async test(
    @StudioCtx() studio: StudioRequestContext,
    @Param('id') id: string,
  ): Promise<TestConnectionResultDto> {
    return this.llm.testConnection(studio.id, id);
  }

  @Post(':id/browser-login')
  @HttpCode(HttpStatus.OK)
  async browserLogin(
    @StudioCtx() studio: StudioRequestContext,
    @Param('id') id: string,
  ): Promise<BrowserSessionStatusDto> {
    return this.llm.launchBrowserLogin(studio.id, id);
  }

  @Post(':id/pull-model')
  @HttpCode(HttpStatus.OK)
  async pullModel(
    @StudioCtx() studio: StudioRequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PullLocalModelSchema)) body: PullLocalModelRequest,
  ): Promise<{ ok: boolean; model: string; status: string }> {
    return this.llm.pullLocalModel(studio.id, id, body);
  }

  @Post(':id/runpod-pod')
  @HttpCode(HttpStatus.OK)
  async controlRunpodPod(
    @StudioCtx() studio: StudioRequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RunpodPodActionSchema)) body: RunpodPodActionRequest,
  ): Promise<RunpodPodStatusDto> {
    return this.llm.controlRunpodPod(studio.id, id, body);
  }

  @Post(':id/bind-all')
  @HttpCode(HttpStatus.OK)
  async bindAllAgents(
    @StudioCtx() studio: StudioRequestContext,
    @Param('id') id: string,
    @Body() body?: { modelId?: string },
  ): Promise<{ boundCount: number; modelId: string }> {
    return this.llm.bindAllAgents(studio.id, id, body?.modelId);
  }

  @Get(':id/models')
  async listModels(
    @StudioCtx() studio: StudioRequestContext,
    @Param('id') id: string,
  ): Promise<LlmModelInfoDto[]> {
    return this.llm.listModels(studio.id, id);
  }
}
