import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { McpServerInfoDto, McpToolCallResultDto } from '@robdev/shared';
import type { Observable } from 'rxjs';
import { API_PATHS } from './api-paths';

@Injectable({ providedIn: 'root' })
export class McpApiService {
  private readonly http = inject(HttpClient);

  getInfo(): Observable<McpServerInfoDto> {
    return this.http.get<McpServerInfoDto>(API_PATHS.mcp.info());
  }

  callTool(
    toolName: string,
    args: Record<string, unknown> = {},
  ): Observable<McpToolCallResultDto> {
    return this.http.post<McpToolCallResultDto>(
      API_PATHS.mcp.callTool(toolName),
      args,
    );
  }

  sendJsonRpc(payload: Record<string, unknown>): Observable<unknown> {
    return this.http.post<unknown>(API_PATHS.mcp.rpc(), payload);
  }
}
