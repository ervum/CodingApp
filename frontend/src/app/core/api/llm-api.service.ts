import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  AgentKey,
  BrowserSessionStatusDto,
  BrowserVisibilityStatusDto,
  CreateLlmConnectionRequest,
  DeleteWebChatsResultDto,
  DetectedLocalRuntimeDto,
  DetectedLocalServerDto,
  LlmConnectionDto,
  LlmModelInfoDto,
  PullLocalModelRequest,
  RunpodPodActionRequest,
  RunpodPodStatusDto,
  TestConnectionResultDto,
  UpdateLlmConnectionRequest,
  WebChatSessionDto,
} from '@robdev/shared';
import type { Observable } from 'rxjs';
import { API_PATHS } from './api-paths';

@Injectable({ providedIn: 'root' })
export class LlmApiService {
  private readonly http = inject(HttpClient);

  listConnections(studioId: string): Observable<LlmConnectionDto[]> {
    return this.http.get<LlmConnectionDto[]>(API_PATHS.llm.connections(studioId));
  }

  detectLocalServers(studioId: string): Observable<DetectedLocalServerDto[]> {
    return this.http.get<DetectedLocalServerDto[]>(API_PATHS.llm.localDetect(studioId));
  }

  detectLocalRuntimes(
    studioId: string,
    refresh = false,
  ): Observable<DetectedLocalRuntimeDto[]> {
    let params = new HttpParams();
    if (refresh) {
      params = params.set('refresh', 'true');
    }
    return this.http.get<DetectedLocalRuntimeDto[]>(API_PATHS.llm.localRuntimes(studioId), {
      params,
    });
  }

  createConnection(
    studioId: string,
    body: CreateLlmConnectionRequest,
  ): Observable<LlmConnectionDto> {
    return this.http.post<LlmConnectionDto>(API_PATHS.llm.connections(studioId), body);
  }

  updateConnection(
    studioId: string,
    id: string,
    body: UpdateLlmConnectionRequest,
  ): Observable<LlmConnectionDto> {
    return this.http.patch<LlmConnectionDto>(API_PATHS.llm.connectionById(studioId, id), body);
  }

  deleteConnection(studioId: string, id: string): Observable<void> {
    return this.http.delete<void>(API_PATHS.llm.connectionById(studioId, id));
  }

  testConnection(studioId: string, id: string): Observable<TestConnectionResultDto> {
    return this.http.post<TestConnectionResultDto>(API_PATHS.llm.testConnection(studioId, id), {});
  }

  browserLogin(studioId: string, id: string): Observable<BrowserSessionStatusDto> {
    return this.http.post<BrowserSessionStatusDto>(API_PATHS.llm.browserLogin(studioId, id), {});
  }

  pullModel(
    studioId: string,
    id: string,
    body: PullLocalModelRequest,
  ): Observable<{ ok: boolean; model: string; status: string }> {
    return this.http.post<{ ok: boolean; model: string; status: string }>(
      API_PATHS.llm.pullModel(studioId, id),
      body,
    );
  }

  controlRunpodPod(
    studioId: string,
    id: string,
    body: RunpodPodActionRequest,
  ): Observable<RunpodPodStatusDto> {
    return this.http.post<RunpodPodStatusDto>(API_PATHS.llm.runpodPod(studioId, id), body);
  }

  bindAllAgents(
    studioId: string,
    id: string,
    modelId?: string,
  ): Observable<{ boundCount: number; modelId: string }> {
    return this.http.post<{ boundCount: number; modelId: string }>(
      API_PATHS.llm.bindAll(studioId, id),
      modelId ? { modelId } : {},
    );
  }

  listModels(studioId: string, id: string): Observable<LlmModelInfoDto[]> {
    return this.http.get<LlmModelInfoDto[]>(API_PATHS.llm.models(studioId, id));
  }

  getBrowserVisibility(studioId: string): Observable<BrowserVisibilityStatusDto> {
    return this.http.get<BrowserVisibilityStatusDto>(API_PATHS.llm.browserVisibility(studioId));
  }

  setBrowserVisibility(
    studioId: string,
    visible: boolean,
  ): Observable<BrowserVisibilityStatusDto> {
    return this.http.post<BrowserVisibilityStatusDto>(
      API_PATHS.llm.browserVisibility(studioId),
      { visible },
    );
  }

  answerNow(
    studioId: string,
    body?: { runId?: string | null; agentKey?: AgentKey },
  ): Observable<{ ok: boolean; message: string }> {
    return this.http.post<{ ok: boolean; message: string }>(
      API_PATHS.llm.answerNow(studioId),
      {
        ...(body?.runId ? { runId: body.runId } : {}),
        ...(body?.agentKey ? { agentKey: body.agentKey } : {}),
      },
    );
  }

  listWebChats(studioId: string, agentKey?: AgentKey): Observable<WebChatSessionDto[]> {
    let params = new HttpParams();
    if (agentKey) {
      params = params.set('agentKey', agentKey);
    }
    return this.http.get<WebChatSessionDto[]>(API_PATHS.llm.webChats(studioId), { params });
  }

  deleteLastRunWebChats(studioId: string): Observable<DeleteWebChatsResultDto> {
    return this.http.delete<DeleteWebChatsResultDto>(API_PATHS.llm.webChatsLastRun(studioId));
  }

  deleteAgentWebChats(
    studioId: string,
    agentKey: AgentKey,
  ): Observable<DeleteWebChatsResultDto> {
    return this.http.delete<DeleteWebChatsResultDto>(
      API_PATHS.llm.webChatsByAgent(studioId, agentKey),
    );
  }

  deleteWebChat(studioId: string, chatId: string): Observable<DeleteWebChatsResultDto> {
    return this.http.delete<DeleteWebChatsResultDto>(
      API_PATHS.llm.webChatById(studioId, chatId),
    );
  }
}
