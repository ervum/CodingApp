import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  AgentDetailDto,
  AgentDto,
  AgentKey,
  AgentMessageDto,
  AgentRunDetailDto,
  AgentRunSummaryDto,
  AgentVaultBindingDto,
  ChatArchiveDetailDto,
  ChatArchiveSummaryDto,
  ChatAttachment,
  ChatBranchRequest,
  ChatDeletePartRequest,
  ChatMentionItemDto,
  ChatRetryRequest,
  LeadAskRequest,
  Paginated,
  PostAgentMessageRequest,
  PutVaultBindingsRequest,
  TaskDto,
  UpdateAgentRequest,
} from '@robdev/shared';
import type { Observable } from 'rxjs';
import { API_PATHS } from './api-paths';

@Injectable({ providedIn: 'root' })
export class AgentsApiService {
  private readonly http = inject(HttpClient);

  list(studioId: string): Observable<AgentDto[]> {
    return this.http.get<AgentDto[]>(API_PATHS.agents.list(studioId));
  }

  getDetail(studioId: string, agentKey: AgentKey): Observable<AgentDetailDto> {
    return this.http.get<AgentDetailDto>(API_PATHS.agents.byKey(studioId, agentKey));
  }

  update(
    studioId: string,
    agentKey: AgentKey,
    body: UpdateAgentRequest,
  ): Observable<AgentDetailDto> {
    return this.http.patch<AgentDetailDto>(API_PATHS.agents.byKey(studioId, agentKey), body);
  }

  putVaultBindings(
    studioId: string,
    agentKey: AgentKey,
    body: PutVaultBindingsRequest,
  ): Observable<AgentVaultBindingDto[]> {
    return this.http.put<AgentVaultBindingDto[]>(
      API_PATHS.agents.vaultBindings(studioId, agentKey),
      body,
    );
  }

  listRuns(
    studioId: string,
    agentKey: AgentKey,
    opts?: { cursor?: string; limit?: number },
  ): Observable<Paginated<AgentRunSummaryDto>> {
    let params = new HttpParams();
    if (opts?.cursor) params = params.set('cursor', opts.cursor);
    if (opts?.limit !== undefined) params = params.set('limit', String(opts.limit));
    return this.http.get<Paginated<AgentRunSummaryDto>>(
      API_PATHS.agents.runs(studioId, agentKey),
      { params },
    );
  }

  listMessages(
    studioId: string,
    agentKey: AgentKey,
    opts?: { cursor?: string; limit?: number },
  ): Observable<Paginated<AgentMessageDto>> {
    let params = new HttpParams();
    if (opts?.cursor) params = params.set('cursor', opts.cursor);
    if (opts?.limit !== undefined) params = params.set('limit', String(opts.limit));
    return this.http.get<Paginated<AgentMessageDto>>(
      API_PATHS.agents.messages(studioId, agentKey),
      { params },
    );
  }

  postMessage(
    studioId: string,
    agentKey: AgentKey,
    body: PostAgentMessageRequest,
  ): Observable<{ message: AgentMessageDto; task: TaskDto }> {
    return this.http.post<{ message: AgentMessageDto; task: TaskDto }>(
      API_PATHS.agents.messages(studioId, agentKey),
      body,
    );
  }

  getRunDetail(studioId: string, runId: string): Observable<AgentRunDetailDto> {
    return this.http.get<AgentRunDetailDto>(API_PATHS.agents.runById(studioId, runId));
  }

  cancelRun(studioId: string, runId: string): Observable<AgentRunSummaryDto> {
    return this.http.post<AgentRunSummaryDto>(API_PATHS.agents.cancelRun(studioId, runId), {});
  }

  deleteRun(
    studioId: string,
    runId: string,
  ): Observable<{ deletedRunId: string; deletedTaskId: string | null }> {
    return this.http.delete<{ deletedRunId: string; deletedTaskId: string | null }>(
      API_PATHS.agents.runById(studioId, runId),
    );
  }

  deleteAgentRuns(
    studioId: string,
    agentKey: AgentKey,
  ): Observable<{ deletedCount: number }> {
    return this.http.delete<{ deletedCount: number }>(
      API_PATHS.agents.runs(studioId, agentKey),
    );
  }

  deleteAllStudioRuns(studioId: string): Observable<{ deletedCount: number }> {
    return this.http.delete<{ deletedCount: number }>(
      API_PATHS.agents.allRuns(studioId),
    );
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

  listChatArchives(
    studioId: string,
    agentKey: AgentKey,
  ): Observable<ChatArchiveSummaryDto[]> {
    return this.http.get<ChatArchiveSummaryDto[]>(
      API_PATHS.agents.chatArchives(studioId, agentKey),
    );
  }

  getChatArchive(
    studioId: string,
    agentKey: AgentKey,
    archiveId: string,
  ): Observable<ChatArchiveDetailDto> {
    return this.http.get<ChatArchiveDetailDto>(
      API_PATHS.agents.chatArchiveById(studioId, agentKey, archiveId),
    );
  }

  freshStartChat(
    studioId: string,
    agentKey: AgentKey,
  ): Observable<{ archive: ChatArchiveSummaryDto | null }> {
    return this.http.post<{ archive: ChatArchiveSummaryDto | null }>(
      API_PATHS.agents.chatFreshStart(studioId, agentKey),
      {},
    );
  }

  branchChat(
    studioId: string,
    agentKey: AgentKey,
    body: ChatBranchRequest,
  ): Observable<{ archive: ChatArchiveSummaryDto | null }> {
    return this.http.post<{ archive: ChatArchiveSummaryDto | null }>(
      API_PATHS.agents.chatBranch(studioId, agentKey),
      body,
    );
  }

  retryChat(
    studioId: string,
    agentKey: AgentKey,
    body: ChatRetryRequest,
  ): Observable<{ archive: ChatArchiveSummaryDto | null; task: TaskDto }> {
    return this.http.post<{ archive: ChatArchiveSummaryDto | null; task: TaskDto }>(
      API_PATHS.agents.chatRetry(studioId, agentKey),
      body,
    );
  }

  deleteChatPart(
    studioId: string,
    agentKey: AgentKey,
    body: ChatDeletePartRequest,
  ): Observable<{ deletedMessageCount: number; deletedRunCount: number }> {
    return this.http.post<{ deletedMessageCount: number; deletedRunCount: number }>(
      API_PATHS.agents.chatDeletePart(studioId, agentKey),
      body,
    );
  }

  deleteChatArchive(
    studioId: string,
    agentKey: AgentKey,
    archiveId: string,
  ): Observable<{ deletedArchiveId: string }> {
    return this.http.delete<{ deletedArchiveId: string }>(
      API_PATHS.agents.chatArchiveById(studioId, agentKey, archiveId),
    );
  }

  deleteAllChatArchives(
    studioId: string,
    agentKey: AgentKey,
  ): Observable<{ deletedCount: number }> {
    return this.http.delete<{ deletedCount: number }>(
      API_PATHS.agents.chatArchives(studioId, agentKey),
    );
  }

  listChatMentions(
    studioId: string,
    opts?: { q?: string; agentKey?: AgentKey },
  ): Observable<ChatMentionItemDto[]> {
    let params = new HttpParams();
    if (opts?.q) params = params.set('q', opts.q);
    if (opts?.agentKey) params = params.set('agentKey', opts.agentKey);
    return this.http.get<ChatMentionItemDto[]>(API_PATHS.chat.mentions(studioId), {
      params,
    });
  }

  uploadChatFiles(
    studioId: string,
    body: {
      mode?: 'files' | 'folder';
      folderName?: string;
      files: Array<{
        name: string;
        relPath?: string;
        mimeType?: string;
        base64: string;
      }>;
    },
  ): Observable<{ attachments: ChatAttachment[] }> {
    return this.http.post<{ attachments: ChatAttachment[] }>(
      API_PATHS.chat.uploads(studioId),
      body,
    );
  }

  pickChatLocalFolder(
    studioId: string,
  ): Observable<{ attachment: ChatAttachment | null; cancelled: boolean }> {
    return this.http.post<{ attachment: ChatAttachment | null; cancelled: boolean }>(
      API_PATHS.chat.pickFolder(studioId),
      {},
    );
  }

  captureChatScreenshot(
    studioId: string,
    windowTitle?: string,
  ): Observable<{ attachment: ChatAttachment }> {
    return this.http.post<{ attachment: ChatAttachment }>(
      API_PATHS.chat.screenshot(studioId),
      windowTitle ? { windowTitle } : {},
    );
  }
}
