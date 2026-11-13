import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { CreateLaneRequest, StudioLaneDto } from '@robdev/shared';
import type { Observable } from 'rxjs';
import { API_PATHS } from './api-paths';

@Injectable({ providedIn: 'root' })
export class LanesApiService {
  private readonly http = inject(HttpClient);

  list(studioId: string): Observable<StudioLaneDto[]> {
    return this.http.get<StudioLaneDto[]>(API_PATHS.lanes.list(studioId));
  }

  create(studioId: string, body: CreateLaneRequest): Observable<StudioLaneDto> {
    return this.http.post<StudioLaneDto>(API_PATHS.lanes.create(studioId), body);
  }

  release(studioId: string, laneId: string): Observable<StudioLaneDto> {
    return this.http.post<StudioLaneDto>(API_PATHS.lanes.release(studioId, laneId), {});
  }
}
