import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  CreateStudioAssetRequest,
  ListStudioAssetsQuery,
  StudioAssetDto,
  UpdateStudioAssetRequest,
} from '@robdev/shared';
import type { Observable } from 'rxjs';
import { API_PATHS } from './api-paths';

@Injectable({ providedIn: 'root' })
export class AssetsApiService {
  private readonly http = inject(HttpClient);

  list(studioId: string, query?: Partial<ListStudioAssetsQuery>): Observable<StudioAssetDto[]> {
    let params = new HttpParams();
    if (query?.kind) params = params.set('kind', query.kind);
    if (query?.q) params = params.set('q', query.q);
    if (query?.tag) params = params.set('tag', query.tag);
    return this.http.get<StudioAssetDto[]>(API_PATHS.assets.list(studioId), { params });
  }

  create(studioId: string, body: CreateStudioAssetRequest): Observable<StudioAssetDto> {
    return this.http.post<StudioAssetDto>(API_PATHS.assets.create(studioId), body);
  }

  upload(studioId: string, formData: FormData): Observable<StudioAssetDto> {
    return this.http.post<StudioAssetDto>(API_PATHS.assets.upload(studioId), formData);
  }

  update(
    studioId: string,
    assetId: string,
    body: UpdateStudioAssetRequest,
  ): Observable<StudioAssetDto> {
    return this.http.patch<StudioAssetDto>(API_PATHS.assets.byId(studioId, assetId), body);
  }

  delete(studioId: string, assetId: string): Observable<{ deletedId: string }> {
    return this.http.delete<{ deletedId: string }>(API_PATHS.assets.byId(studioId, assetId));
  }
}
