import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  GameDto,
  GeneratePitchesRequest,
  PickPitchRequest,
  PitchDetailDto,
  PitchDto,
  PitchStatus,
  RequestPitchChangesRequest,
  TaskDto,
  UpdatePitchRequest,
} from '@robdev/shared';
import type { Observable } from 'rxjs';
import { API_PATHS } from './api-paths';

@Injectable({ providedIn: 'root' })
export class PitchesApiService {
  private readonly http = inject(HttpClient);

  list(studioId: string, status?: PitchStatus): Observable<PitchDto[]> {
    let params = new HttpParams();
    if (status) params = params.set('status', status);
    return this.http.get<PitchDto[]>(API_PATHS.pitches.list(studioId), { params });
  }

  getDetail(studioId: string, id: string): Observable<PitchDetailDto> {
    return this.http.get<PitchDetailDto>(API_PATHS.pitches.byId(studioId, id));
  }

  generate(studioId: string, body: GeneratePitchesRequest): Observable<TaskDto> {
    return this.http.post<TaskDto>(API_PATHS.pitches.generate(studioId), body);
  }

  update(studioId: string, id: string, body: UpdatePitchRequest): Observable<PitchDetailDto> {
    return this.http.patch<PitchDetailDto>(API_PATHS.pitches.byId(studioId, id), body);
  }

  pick(
    studioId: string,
    id: string,
    body: PickPitchRequest = {},
  ): Observable<{ pitch: PitchDto; game: GameDto }> {
    return this.http.post<{ pitch: PitchDto; game: GameDto }>(
      API_PATHS.pitches.pick(studioId, id),
      body,
    );
  }

  requestChanges(
    studioId: string,
    id: string,
    body: RequestPitchChangesRequest,
  ): Observable<{ pitch: PitchDto; task: TaskDto }> {
    return this.http.post<{ pitch: PitchDto; task: TaskDto }>(
      API_PATHS.pitches.requestChanges(studioId, id),
      body,
    );
  }
}
