import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  AddWorkspaceFileCommentRequest,
  SaveWorkspaceFileRequest,
  WorkspaceFileCommentDto,
  WorkspaceFileDetailDto,
  WorkspaceOverviewDto,
} from '@robdev/shared';
import type { Observable } from 'rxjs';
import { API_PATHS } from './api-paths';

@Injectable({ providedIn: 'root' })
export class WorkspaceApiService {
  private readonly http = inject(HttpClient);

  getOverview(studioId: string): Observable<WorkspaceOverviewDto> {
    return this.http.get<WorkspaceOverviewDto>(API_PATHS.workspace.tree(studioId));
  }

  getFileDetail(studioId: string, path: string): Observable<WorkspaceFileDetailDto> {
    const params = new HttpParams().set('path', path);
    return this.http.get<WorkspaceFileDetailDto>(API_PATHS.workspace.file(studioId), {
      params,
    });
  }

  addComment(
    studioId: string,
    body: AddWorkspaceFileCommentRequest,
  ): Observable<WorkspaceFileCommentDto> {
    return this.http.post<WorkspaceFileCommentDto>(
      API_PATHS.workspace.comments(studioId),
      body,
    );
  }

  saveFile(
    studioId: string,
    body: SaveWorkspaceFileRequest,
  ): Observable<WorkspaceFileDetailDto> {
    return this.http.put<WorkspaceFileDetailDto>(
      API_PATHS.workspace.file(studioId),
      body,
    );
  }
}
