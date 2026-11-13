import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  HumanRequestDto,
  HumanRequestStatus,
  ReplyHumanRequest,
  ResolveHumanRequest,
} from '@robdev/shared';
import type { Observable } from 'rxjs';
import { API_PATHS } from './api-paths';

@Injectable({ providedIn: 'root' })
export class HumanRequestsApiService {
  private readonly http = inject(HttpClient);

  list(studioId: string, status: HumanRequestStatus = 'OPEN'): Observable<HumanRequestDto[]> {
    const params = new HttpParams().set('status', status);
    return this.http.get<HumanRequestDto[]>(API_PATHS.humanRequests.list(studioId), { params });
  }

  reply(studioId: string, id: string, body: ReplyHumanRequest): Observable<HumanRequestDto> {
    return this.http.post<HumanRequestDto>(API_PATHS.humanRequests.reply(studioId, id), body);
  }

  resolve(studioId: string, id: string, body: ResolveHumanRequest): Observable<HumanRequestDto> {
    return this.http.post<HumanRequestDto>(API_PATHS.humanRequests.resolve(studioId, id), body);
  }
}
