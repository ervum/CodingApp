import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  AgentMessageDto,
  CreateTaskRequest,
  LeadAskRequest,
  ListTasksQuery,
  Paginated,
  TaskDetailDto,
  TaskDto,
  TaskFeedbackRequest,
  TaskOutputDto,
  UpdateTaskRequest,
} from '@robdev/shared';
import type { Observable } from 'rxjs';
import { API_PATHS } from './api-paths';

@Injectable({ providedIn: 'root' })
export class TasksApiService {
  private readonly http = inject(HttpClient);

  list(studioId: string, query?: Partial<ListTasksQuery>): Observable<Paginated<TaskDto>> {
    let params = new HttpParams();
    if (query?.status) params = params.set('status', query.status);
    if (query?.agentKey) params = params.set('agentKey', query.agentKey);
    if (query?.gameId) params = params.set('gameId', query.gameId);
    if (query?.priority) params = params.set('priority', query.priority);
    if (query?.inbox !== undefined) params = params.set('inbox', String(query.inbox));
    if (query?.cursor) params = params.set('cursor', query.cursor);
    if (query?.limit !== undefined) params = params.set('limit', String(query.limit));
    return this.http.get<Paginated<TaskDto>>(API_PATHS.tasks.list(studioId), { params });
  }

  create(studioId: string, body: CreateTaskRequest): Observable<TaskDto> {
    return this.http.post<TaskDto>(API_PATHS.tasks.create(studioId), body);
  }

  getDetail(studioId: string, taskId: string): Observable<TaskDetailDto> {
    return this.http.get<TaskDetailDto>(API_PATHS.tasks.byId(studioId, taskId));
  }

  listOutputs(studioId: string): Observable<{ items: TaskOutputDto[] }> {
    return this.http.get<{ items: TaskOutputDto[] }>(API_PATHS.tasks.outputs(studioId));
  }

  getTaskOutput(studioId: string, taskId: string): Observable<{ output: TaskOutputDto | null }> {
    return this.http.get<{ output: TaskOutputDto | null }>(
      API_PATHS.tasks.outputById(studioId, taskId),
    );
  }

  update(studioId: string, taskId: string, body: UpdateTaskRequest): Observable<TaskDto> {
    return this.http.patch<TaskDto>(API_PATHS.tasks.byId(studioId, taskId), body);
  }

  cancel(studioId: string, taskId: string): Observable<TaskDto> {
    return this.http.post<TaskDto>(API_PATHS.tasks.cancel(studioId, taskId), {});
  }

  retry(studioId: string, taskId: string): Observable<TaskDto> {
    return this.http.post<TaskDto>(API_PATHS.tasks.retry(studioId, taskId), {});
  }

  accept(studioId: string, taskId: string): Observable<TaskDto> {
    return this.http.post<TaskDto>(API_PATHS.tasks.accept(studioId, taskId), {});
  }

  feedback(
    studioId: string,
    taskId: string,
    body: TaskFeedbackRequest,
  ): Observable<TaskDto> {
    return this.http.post<TaskDto>(API_PATHS.tasks.feedback(studioId, taskId), body);
  }

  askLead(
    studioId: string,
    body: LeadAskRequest,
  ): Observable<{ message: AgentMessageDto; task: TaskDto }> {
    return this.http.post<{ message: AgentMessageDto; task: TaskDto }>(
      API_PATHS.agents.leadAsk(studioId),
      body,
    );
  }
}
