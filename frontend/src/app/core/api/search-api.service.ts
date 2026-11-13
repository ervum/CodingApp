import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { QuickJumpResultDto } from '@robdev/shared';
import type { Observable } from 'rxjs';
import { API_PATHS } from './api-paths';

@Injectable({ providedIn: 'root' })
export class SearchApiService {
  private readonly http = inject(HttpClient);

  quickJump(studioId: string, q: string): Observable<QuickJumpResultDto[]> {
    const params = new HttpParams().set('q', q);
    return this.http.get<QuickJumpResultDto[]>(API_PATHS.search.quickJump(studioId), { params });
  }
}
