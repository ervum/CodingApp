import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  AddWorkspaceFileCommentSchema,
  SaveWorkspaceFileSchema,
  type AddWorkspaceFileCommentRequest,
  type SaveWorkspaceFileRequest,
  type WorkspaceFileCommentDto,
  type WorkspaceFileDetailDto,
  type WorkspaceOverviewDto,
} from '@robdev/shared';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator.js';
import {
  StudioCtx,
  type StudioRequestContext,
} from '../../common/decorators/studio-context.decorator.js';
import { StudioAccessGuard } from '../../common/guards/studio-access.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { WorkspaceService } from './workspace.service.js';

@Controller('studios/:studioId/workspace')
@UseGuards(StudioAccessGuard)
export class WorkspaceController {
  constructor(private readonly workspace: WorkspaceService) {}

  @Get('tree')
  async getOverview(
    @StudioCtx() studio: StudioRequestContext,
  ): Promise<WorkspaceOverviewDto> {
    return this.workspace.getOverview(studio.id);
  }

  @Get('file')
  async getFileDetail(
    @StudioCtx() studio: StudioRequestContext,
    @Query('path') pathQuery: string | undefined,
  ): Promise<WorkspaceFileDetailDto> {
    return this.workspace.getFileDetail(studio.id, pathQuery ?? '');
  }

  @Post('file/comments')
  async addComment(
    @StudioCtx() studio: StudioRequestContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(AddWorkspaceFileCommentSchema))
    body: AddWorkspaceFileCommentRequest,
  ): Promise<WorkspaceFileCommentDto> {
    return this.workspace.addComment(studio.id, body, user);
  }

  @Put('file')
  async saveFile(
    @StudioCtx() studio: StudioRequestContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(SaveWorkspaceFileSchema))
    body: SaveWorkspaceFileRequest,
  ): Promise<WorkspaceFileDetailDto> {
    return this.workspace.saveOrRestoreFile(studio.id, body, user);
  }
}
