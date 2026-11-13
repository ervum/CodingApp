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
  UseGuards,
} from '@nestjs/common';
import {
  AddMemberSchema,
  UpdateMemberSchema,
  type AddMemberRequest,
  type MemberDto,
  type UpdateMemberRequest,
} from '@robdev/shared';
import {
  StudioCtx,
  type StudioRequestContext,
} from '../../common/decorators/studio-context.decorator.js';
import { StudioRoles } from '../../common/decorators/studio-roles.decorator.js';
import { StudioAccessGuard } from '../../common/guards/studio-access.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { MembersService } from './members.service.js';

@Controller('studios/:studioId/members')
@UseGuards(StudioAccessGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  async list(@Param('studioId') studioId: string): Promise<MemberDto[]> {
    return this.members.list(studioId);
  }

  @Post()
  @StudioRoles('ADMIN')
  async add(
    @Param('studioId') studioId: string,
    @Body(new ZodValidationPipe(AddMemberSchema)) body: AddMemberRequest,
  ): Promise<MemberDto> {
    return this.members.add(studioId, body);
  }

  @Patch(':userId')
  @StudioRoles('ADMIN')
  async updateRole(
    @Param('studioId') studioId: string,
    @Param('userId') targetUserId: string,
    @Body(new ZodValidationPipe(UpdateMemberSchema)) body: UpdateMemberRequest,
    @StudioCtx() studio: StudioRequestContext,
  ): Promise<MemberDto> {
    return this.members.updateRole(studioId, targetUserId, body, studio.role);
  }

  @Delete(':userId')
  @StudioRoles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('studioId') studioId: string,
    @Param('userId') targetUserId: string,
    @StudioCtx() studio: StudioRequestContext,
  ): Promise<void> {
    await this.members.remove(studioId, targetUserId, studio.role);
  }
}
