import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  CreateGameRequest,
  GameBuildDto,
  GameDetailDto,
  GameDto,
  GameMilestoneDto,
  Paginated,
  PublishGameOpenCloudRequest,
  PublishGameOpenCloudResultDto,
  RecordBuildRequest,
  UpdateGameRequest,
  UpdateMilestoneRequest,
} from '@robdev/shared';
import type { Observable } from 'rxjs';
import { API_PATHS } from './api-paths';

@Injectable({ providedIn: 'root' })
export class GamesApiService {
  private readonly http = inject(HttpClient);

  list(studioId: string): Observable<GameDto[]> {
    return this.http.get<GameDto[]>(API_PATHS.games.list(studioId));
  }

  create(studioId: string, body: CreateGameRequest): Observable<GameDto> {
    return this.http.post<GameDto>(API_PATHS.games.create(studioId), body);
  }

  getDetail(studioId: string, gameId: string): Observable<GameDetailDto> {
    return this.http.get<GameDetailDto>(API_PATHS.games.byId(studioId, gameId));
  }

  update(studioId: string, gameId: string, body: UpdateGameRequest): Observable<GameDto> {
    return this.http.patch<GameDto>(API_PATHS.games.byId(studioId, gameId), body);
  }

  listBuilds(
    studioId: string,
    gameId: string,
    opts?: { cursor?: string; limit?: number },
  ): Observable<Paginated<GameBuildDto>> {
    let params = new HttpParams();
    if (opts?.cursor) params = params.set('cursor', opts.cursor);
    if (opts?.limit !== undefined) params = params.set('limit', String(opts.limit));
    return this.http.get<Paginated<GameBuildDto>>(API_PATHS.games.builds(studioId, gameId), {
      params,
    });
  }

  recordBuild(
    studioId: string,
    gameId: string,
    body: RecordBuildRequest,
  ): Observable<GameBuildDto> {
    return this.http.post<GameBuildDto>(API_PATHS.games.builds(studioId, gameId), body);
  }

  updateMilestone(
    studioId: string,
    gameId: string,
    milestoneId: string,
    body: UpdateMilestoneRequest,
  ): Observable<GameMilestoneDto> {
    return this.http.patch<GameMilestoneDto>(
      API_PATHS.games.milestone(studioId, gameId, milestoneId),
      body,
    );
  }

  publishOpenCloud(
    studioId: string,
    gameId: string,
    body?: PublishGameOpenCloudRequest,
  ): Observable<PublishGameOpenCloudResultDto> {
    return this.http.post<PublishGameOpenCloudResultDto>(
      API_PATHS.games.publish(studioId, gameId),
      body ?? { versionType: 'Published' },
    );
  }
}
