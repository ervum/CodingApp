import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CreateVaultDocumentSchema,
  CreateVaultFolderSchema,
  SaveVaultDocumentSchema,
  VaultSearchQuerySchema,
  type CreateVaultDocumentRequest,
  type CreateVaultFolderRequest,
  type SaveVaultDocumentRequest,
  type VaultDocumentDto,
  type VaultGraphDto,
  type VaultRevisionDto,
  type VaultSearchHitDto,
  type VaultSearchQuery,
  type VaultTreeNodeDto,
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
import { StudioAccessGuard } from '../../common/guards/studio-access.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { VaultDiskSyncService } from './vault-disk-sync.service.js';
import { VaultSearchService } from './vault-search.service.js';
import { VaultService } from './vault.service.js';

@Controller('studios/:studioId/vault')
@UseGuards(StudioAccessGuard)
export class VaultController {
  constructor(
    private readonly vault: VaultService,
    private readonly searchService: VaultSearchService,
    private readonly diskSync: VaultDiskSyncService,
  ) {}

  @Get('tree')
  async tree(@StudioCtx() studio: StudioRequestContext): Promise<VaultTreeNodeDto[]> {
    return this.vault.tree(studio.id);
  }

  @Get('graph')
  async graph(@StudioCtx() studio: StudioRequestContext): Promise<VaultGraphDto> {
    return this.vault.getGraph(studio.id);
  }

  @Get('by-path')
  async getByPath(
    @StudioCtx() studio: StudioRequestContext,
    @Query('path') pathQuery: string | undefined,
  ): Promise<VaultDocumentDto> {
    return this.vault.getDocumentByPath(studio.id, pathQuery ?? '');
  }

  @Get('search')
  async search(
    @StudioCtx() studio: StudioRequestContext,
    @Query(new ZodValidationPipe(VaultSearchQuerySchema)) query: VaultSearchQuery,
  ): Promise<VaultSearchHitDto[]> {
    return this.searchService.search(studio.id, query.q, query.limit);
  }

  @Post('sync')
  @StudioRoles('ADMIN')
  @HttpCode(HttpStatus.OK)
  async sync(
    @StudioCtx() studio: StudioRequestContext,
  ): Promise<{ exported: number; imported: number }> {
    return this.diskSync.reconcileStudio(studio.id);
  }

  @Post('folders')
  @StudioRoles('PRODUCER')
  async createFolder(
    @StudioCtx() studio: StudioRequestContext,
    @Body(new ZodValidationPipe(CreateVaultFolderSchema)) body: CreateVaultFolderRequest,
  ): Promise<VaultTreeNodeDto> {
    return this.vault.createFolder(studio.id, body);
  }

  @Post('documents')
  @StudioRoles('PRODUCER')
  async createDocument(
    @StudioCtx() studio: StudioRequestContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateVaultDocumentSchema)) body: CreateVaultDocumentRequest,
  ): Promise<VaultDocumentDto> {
    return this.vault.createDocument(studio.id, body, user);
  }

  @Get('documents/:docId')
  async getDocument(
    @StudioCtx() studio: StudioRequestContext,
    @Param('docId') docId: string,
  ): Promise<VaultDocumentDto> {
    return this.vault.getDocument(studio.id, docId);
  }

  @Put('documents/:docId')
  @StudioRoles('PRODUCER')
  async saveDocument(
    @StudioCtx() studio: StudioRequestContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('docId') docId: string,
    @Body(new ZodValidationPipe(SaveVaultDocumentSchema)) body: SaveVaultDocumentRequest,
  ): Promise<VaultDocumentDto> {
    return this.vault.save(studio.id, docId, body, {
      kind: 'USER',
      userId: user.id,
      label: user.displayName,
      reason: 'Edited in Library',
    });
  }

  @Delete('documents/:docId')
  @StudioRoles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteDocument(
    @StudioCtx() studio: StudioRequestContext,
    @Param('docId') docId: string,
  ): Promise<void> {
    await this.vault.deleteDocument(studio.id, docId);
  }

  @Get('documents/:docId/revisions')
  async getRevisions(
    @StudioCtx() studio: StudioRequestContext,
    @Param('docId') docId: string,
  ): Promise<VaultRevisionDto[]> {
    return this.vault.getRevisions(studio.id, docId);
  }

  @Get('documents/:docId/revisions/:version')
  async getRevision(
    @StudioCtx() studio: StudioRequestContext,
    @Param('docId') docId: string,
    @Param('version', ParseIntPipe) version: number,
  ): Promise<{ version: number; markdown: string }> {
    return this.vault.getRevision(studio.id, docId, version);
  }
}
