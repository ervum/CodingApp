import {
  Body,
  Controller,
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
  CreateTaskSchema,
  ListTasksQuerySchema,
  TaskFeedbackSchema,
  UpdateTaskSchema,
  type CreateTaskRequest,
  type ListTasksQuery,
  type Paginated,
  type TaskDetailDto,
  type TaskDto,
  type TaskFeedbackRequest,
  type TaskOutputDto,
  type UpdateTaskRequest,
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
import { TasksService } from './tasks.service.js';

@Controller('studios/:studioId/tasks')
@UseGuards(StudioAccessGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  async list(
    @StudioCtx() studio: StudioRequestContext,
    @Query(new ZodValidationPipe(ListTasksQuerySchema)) query: ListTasksQuery,
  ): Promise<Paginated<TaskDto>> {
    return this.tasks.list(studio.id, query);
  }

  @Post()
  @StudioRoles('PRODUCER')
  async create(
    @StudioCtx() studio: StudioRequestContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateTaskSchema)) body: CreateTaskRequest,
  ): Promise<TaskDto> {
    return this.tasks.create(studio.id, body, user.id);
  }

  @Get('outputs')
  async listOutputs(
    @StudioCtx() studio: StudioRequestContext,
  ): Promise<{ items: TaskOutputDto[] }> {
    const items = await this.tasks.listCompletedOutputs(studio.id, 30);
    return { items };
  }

  @Get(':taskId/output')
  async getTaskOutput(
    @StudioCtx() studio: StudioRequestContext,
    @Param('taskId') taskId: string,
  ): Promise<{ output: TaskOutputDto | null }> {
    const output = await this.tasks.getTaskOutput(studio.id, taskId);
    return { output };
  }

  @Get(':taskId')
  async getDetail(
    @StudioCtx() studio: StudioRequestContext,
    @Param('taskId') taskId: string,
  ): Promise<TaskDetailDto> {
    return this.tasks.getDetail(studio.id, taskId);
  }

  @Patch(':taskId')
  @StudioRoles('PRODUCER')
  async update(
    @StudioCtx() studio: StudioRequestContext,
    @Param('taskId') taskId: string,
    @Body(new ZodValidationPipe(UpdateTaskSchema)) body: UpdateTaskRequest,
  ): Promise<TaskDto> {
    return this.tasks.update(studio.id, taskId, body);
  }

  @Post(':taskId/cancel')
  @StudioRoles('PRODUCER')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @StudioCtx() studio: StudioRequestContext,
    @Param('taskId') taskId: string,
  ): Promise<TaskDto> {
    return this.tasks.cancel(studio.id, taskId);
  }

  @Post(':taskId/retry')
  @StudioRoles('PRODUCER')
  @HttpCode(HttpStatus.OK)
  async retry(
    @StudioCtx() studio: StudioRequestContext,
    @Param('taskId') taskId: string,
  ): Promise<TaskDto> {
    return this.tasks.retry(studio.id, taskId);
  }

  @Post(':taskId/accept')
  @StudioRoles('PRODUCER')
  @HttpCode(HttpStatus.OK)
  async accept(
    @StudioCtx() studio: StudioRequestContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('taskId') taskId: string,
  ): Promise<TaskDto> {
    return this.tasks.accept(studio.id, taskId, user.id);
  }

  @Post(':taskId/feedback')
  @StudioRoles('PRODUCER')
  @HttpCode(HttpStatus.OK)
  async feedback(
    @StudioCtx() studio: StudioRequestContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('taskId') taskId: string,
    @Body(new ZodValidationPipe(TaskFeedbackSchema)) body: TaskFeedbackRequest,
  ): Promise<TaskDto> {
    return this.tasks.feedback(studio.id, taskId, body, user.id);
  }
}
