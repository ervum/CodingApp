import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  CreatePlaybookRequest,
  PlaybookDto,
  RunPlaybookRequest,
  RunPlaybookResultDto,
  UpdatePlaybookRequest,
} from '@robdev/shared';
import type { Observable } from 'rxjs';
import { API_PATHS } from './api-paths';

@Injectable({ providedIn: 'root' })
export class PlaybooksApiService {
  private readonly http = inject(HttpClient);

  list(studioId: string): Observable<PlaybookDto[]> {
    return this.http.get<PlaybookDto[]>(API_PATHS.playbooks.list(studioId));
  }

  create(studioId: string, body: CreatePlaybookRequest): Observable<PlaybookDto> {
    return this.http.post<PlaybookDto>(API_PATHS.playbooks.create(studioId), body);
  }

  update(
    studioId: string,
    playbookId: string,
    body: UpdatePlaybookRequest,
  ): Observable<PlaybookDto> {
    return this.http.patch<PlaybookDto>(API_PATHS.playbooks.byId(studioId, playbookId), body);
  }

  delete(studioId: string, playbookId: string): Observable<{ deletedId: string }> {
    return this.http.delete<{ deletedId: string }>(
      API_PATHS.playbooks.byId(studioId, playbookId),
    );
  }

  run(
    studioId: string,
    playbookId: string,
    body: RunPlaybookRequest,
  ): Observable<RunPlaybookResultDto> {
    return this.http.post<RunPlaybookResultDto>(
      API_PATHS.playbooks.run(studioId, playbookId),
      body,
    );
  }
}
