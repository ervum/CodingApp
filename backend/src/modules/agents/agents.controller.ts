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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  AgentKey,
  ChatBranchRequestSchema,
  ChatDeletePartRequestSchema,
  ChatRetryRequestSchema,
  PostAgentMessageSchema,
  PutVaultBindingsSchema,
  UpdateAgentSchema,
  type AgentDetailDto,
  type AgentDto,
  type AgentMessageDto,
  type AgentRunDetailDto,
  type AgentRunSummaryDto,
  type AgentVaultBindingDto,
  type ChatArchiveDetailDto,
  type ChatArchiveSummaryDto,
  type ChatBranchRequest,
  type ChatDeletePartRequest,
  type ChatRetryRequest,
  type Paginated,
  type PostAgentMessageRequest,
  type PutVaultBindingsRequest,
  type TaskDto,
  type UpdateAgentRequest,
} from '@robdev/shared';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator.js';
import {
  StudioCtx,
  type StudioRequestContext,
} from '../../common/decorators/studio-context.decorator.js';
import { StudioRoles } from '../../common/decorators/studio-roles.decorator.js';
import { AppError } from '../../common/errors/app-error.js';
import { StudioAccessGuard } from '../../common/guards/studio-access.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AgentMessagesService } from './agent-messages.service.js';
import { AgentsService } from './agents.service.js';
import { ChatHistoryService } from './chat-history.service.js';

function parseAgentKey(raw: string): AgentKey {
  if (!(raw in AgentKey)) {
    throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, `Unknown agent key: ${raw}`);
  }
  return raw as AgentKey;
}

@Controller('studios/:studioId')
@UseGuards(StudioAccessGuard)
export class AgentsController {
  constructor(
    private readonly agents: AgentsService,
    private readonly messages: AgentMessagesService,
    private readonly chatHistory: ChatHistoryService,
  ) {}

  @Get('agents')
  async list(@StudioCtx() studio: StudioRequestContext): Promise<AgentDto[]> {
    return this.agents.list(studio.id);
  }

  @Get('agents/:agentKey')
  async getDetail(
    @StudioCtx() studio: StudioRequestContext,
    @Param('agentKey') agentKeyRaw: string,
  ): Promise<AgentDetailDto> {
    return this.agents.getDetail(studio.id, parseAgentKey(agentKeyRaw));
  }

  @Patch('agents/:agentKey')
  @StudioRoles('ADMIN')
  async update(
    @StudioCtx() studio: StudioRequestContext,
    @Param('agentKey') agentKeyRaw: string,
    @Body(new ZodValidationPipe(UpdateAgentSchema)) body: UpdateAgentRequest,
  ): Promise<AgentDetailDto> {
    return this.agents.update(studio.id, parseAgentKey(agentKeyRaw), body);
  }

  @Put('agents/:agentKey/vault-bindings')
  @StudioRoles('ADMIN')
  async putVaultBindings(
    @StudioCtx() studio: StudioRequestContext,
    @Param('agentKey') agentKeyRaw: string,
    @Body(new ZodValidationPipe(PutVaultBindingsSchema)) body: PutVaultBindingsRequest,
  ): Promise<AgentVaultBindingDto[]> {
    return this.agents.putVaultBindings(studio.id, parseAgentKey(agentKeyRaw), body);
  }

  @Get('agents/:agentKey/runs')
  async listRuns(
    @StudioCtx() studio: StudioRequestContext,
    @Param('agentKey') agentKeyRaw: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitRaw?: string,
  ): Promise<Paginated<AgentRunSummaryDto>> {
    const limit = limitRaw ? Math.min(100, Math.max(1, Number(limitRaw) || 20)) : 20;
    return this.agents.listRuns(studio.id, parseAgentKey(agentKeyRaw), cursor, limit);
  }

  @Get('agents/:agentKey/messages')
  async listMessages(
    @StudioCtx() studio: StudioRequestContext,
    @Param('agentKey') agentKeyRaw: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitRaw?: string,
  ): Promise<Paginated<AgentMessageDto>> {
    const limit = limitRaw ? Math.min(100, Math.max(1, Number(limitRaw) || 50)) : 50;
    return this.messages.list(studio.id, parseAgentKey(agentKeyRaw), cursor, limit);
  }

  @Post('agents/:agentKey/messages')
  @StudioRoles('PRODUCER')
  async postMessage(
    @StudioCtx() studio: StudioRequestContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('agentKey') agentKeyRaw: string,
    @Body(new ZodValidationPipe(PostAgentMessageSchema)) body: PostAgentMessageRequest,
  ): Promise<{ message: AgentMessageDto; task: TaskDto }> {
    return this.messages.postUserMessage(studio.id, parseAgentKey(agentKeyRaw), body, user);
  }

  @Get('runs/:runId')
  async getRunDetail(
    @StudioCtx() studio: StudioRequestContext,
    @Param('runId') runId: string,
  ): Promise<AgentRunDetailDto> {
    return this.agents.getRunDetail(studio.id, runId);
  }

  @Post('runs/:runId/cancel')
  @StudioRoles('PRODUCER')
  @HttpCode(HttpStatus.OK)
  async cancelRun(
    @StudioCtx() studio: StudioRequestContext,
    @Param('runId') runId: string,
  ): Promise<AgentRunSummaryDto> {
    return this.agents.cancelRun(studio.id, runId);
  }

  @Delete('runs/:runId')
  @StudioRoles('PRODUCER')
  async deleteRun(
    @StudioCtx() studio: StudioRequestContext,
    @Param('runId') runId: string,
  ): Promise<{ deletedRunId: string; deletedTaskId: string | null }> {
    return this.agents.deleteRun(studio.id, runId);
  }

  @Delete('agents/:agentKey/runs')
  @StudioRoles('PRODUCER')
  async deleteAgentRuns(
    @StudioCtx() studio: StudioRequestContext,
    @Param('agentKey') agentKeyRaw: string,
  ): Promise<{ deletedCount: number }> {
    return this.agents.deleteAgentRuns(studio.id, parseAgentKey(agentKeyRaw));
  }

  @Delete('runs')
  @StudioRoles('PRODUCER')
  async deleteAllStudioRuns(
    @StudioCtx() studio: StudioRequestContext,
  ): Promise<{ deletedCount: number }> {
    return this.agents.deleteAllStudioRuns(studio.id);
  }

  @Get('agents/:agentKey/chat/archives')
  async listChatArchives(
    @StudioCtx() studio: StudioRequestContext,
    @Param('agentKey') agentKeyRaw: string,
  ): Promise<ChatArchiveSummaryDto[]> {
    return this.chatHistory.listArchives(studio.id, parseAgentKey(agentKeyRaw));
  }

  @Get('agents/:agentKey/chat/archives/:archiveId')
  async getChatArchive(
    @StudioCtx() studio: StudioRequestContext,
    @Param('agentKey') agentKeyRaw: string,
    @Param('archiveId') archiveId: string,
  ): Promise<ChatArchiveDetailDto> {
    return this.chatHistory.getArchive(studio.id, parseAgentKey(agentKeyRaw), archiveId);
  }

  @Post('agents/:agentKey/chat/fresh-start')
  @StudioRoles('PRODUCER')
  @HttpCode(HttpStatus.OK)
  async freshStartChat(
    @StudioCtx() studio: StudioRequestContext,
    @Param('agentKey') agentKeyRaw: string,
  ): Promise<{ archive: ChatArchiveSummaryDto | null }> {
    return this.chatHistory.freshStart(studio.id, parseAgentKey(agentKeyRaw));
  }

  @Post('agents/:agentKey/chat/branch')
  @StudioRoles('PRODUCER')
  @HttpCode(HttpStatus.OK)
  async branchChat(
    @StudioCtx() studio: StudioRequestContext,
    @Param('agentKey') agentKeyRaw: string,
    @Body(new ZodValidationPipe(ChatBranchRequestSchema)) body: ChatBranchRequest,
  ): Promise<{ archive: ChatArchiveSummaryDto | null }> {
    return this.chatHistory.branchFrom(studio.id, parseAgentKey(agentKeyRaw), body);
  }

  @Post('agents/:agentKey/chat/retry')
  @StudioRoles('PRODUCER')
  @HttpCode(HttpStatus.OK)
  async retryChat(
    @StudioCtx() studio: StudioRequestContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('agentKey') agentKeyRaw: string,
    @Body(new ZodValidationPipe(ChatRetryRequestSchema)) body: ChatRetryRequest,
  ): Promise<{ archive: ChatArchiveSummaryDto | null; task: TaskDto }> {
    return this.chatHistory.retry(studio.id, parseAgentKey(agentKeyRaw), body, user);
  }

  @Post('agents/:agentKey/chat/delete-part')
  @StudioRoles('PRODUCER')
  @HttpCode(HttpStatus.OK)
  async deleteChatPart(
    @StudioCtx() studio: StudioRequestContext,
    @Param('agentKey') agentKeyRaw: string,
    @Body(new ZodValidationPipe(ChatDeletePartRequestSchema)) body: ChatDeletePartRequest,
  ): Promise<{ ok: true }> {
    return this.chatHistory.deletePart(studio.id, parseAgentKey(agentKeyRaw), body);
  }

  @Delete('agents/:agentKey/chat/archives/:archiveId')
  @StudioRoles('PRODUCER')
  async deleteChatArchive(
    @StudioCtx() studio: StudioRequestContext,
    @Param('agentKey') agentKeyRaw: string,
    @Param('archiveId') archiveId: string,
  ): Promise<{ deletedArchiveId: string }> {
    return this.chatHistory.deleteArchive(studio.id, parseAgentKey(agentKeyRaw), archiveId);
  }

  @Delete('agents/:agentKey/chat/archives')
  @StudioRoles('PRODUCER')
  async deleteAllChatArchives(
    @StudioCtx() studio: StudioRequestContext,
    @Param('agentKey') agentKeyRaw: string,
  ): Promise<{ deletedCount: number }> {
    return this.chatHistory.deleteAllArchives(studio.id, parseAgentKey(agentKeyRaw));
  }
}
