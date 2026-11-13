import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  BlockerDto,
  ListReviewQuery,
  ReviewCountsDto,
  ReviewItemDetailDto,
  ReviewItemDto,
  ReviewKind,
  UpdateBlockerRequest,
  VerdictRequest,
} from '@robdev/shared';
import type { Observable } from 'rxjs';
import { API_PATHS } from './api-paths';

export interface UploadReviewMeta {
  kind: Extract<ReviewKind, 'ICON' | 'THUMBNAIL' | 'TRAILER'>;
  title: string;
  description?: string;
  gameId?: string | null;
}

@Injectable({ providedIn: 'root' })
export class ReviewApiService {
  private readonly http = inject(HttpClient);

  list(studioId: string, query?: Partial<ListReviewQuery>): Observable<ReviewItemDto[]> {
    let params = new HttpParams();
    if (query?.tab) params = params.set('tab', query.tab);
    if (query?.status) params = params.set('status', query.status);
    if (query?.gameId) params = params.set('gameId', query.gameId);
    return this.http.get<ReviewItemDto[]>(API_PATHS.review.list(studioId), { params });
  }

  counts(studioId: string, gameId?: string | null): Observable<ReviewCountsDto> {
    let params = new HttpParams();
    if (gameId && gameId !== 'all') params = params.set('gameId', gameId);
    return this.http.get<ReviewCountsDto>(API_PATHS.review.counts(studioId), { params });
  }

  getDetail(studioId: string, id: string): Observable<ReviewItemDetailDto> {
    return this.http.get<ReviewItemDetailDto>(API_PATHS.review.byId(studioId, id));
  }

  submitVerdict(
    studioId: string,
    id: string,
    body: VerdictRequest,
  ): Observable<ReviewItemDetailDto> {
    return this.http.post<ReviewItemDetailDto>(API_PATHS.review.verdict(studioId, id), body);
  }

  upload(studioId: string, file: File, meta: UploadReviewMeta): Observable<ReviewItemDto> {
    const form = new FormData();
    form.append('file', file);
    form.append('kind', meta.kind);
    form.append('title', meta.title);
    if (meta.description) form.append('description', meta.description);
    if (meta.gameId) form.append('gameId', meta.gameId);
    return this.http.post<ReviewItemDto>(API_PATHS.review.upload(studioId), form);
  }

  resolveBlocker(
    studioId: string,
    blockerId: string,
    body: UpdateBlockerRequest,
  ): Observable<BlockerDto> {
    return this.http.patch<BlockerDto>(API_PATHS.review.blocker(studioId, blockerId), body);
  }
}
