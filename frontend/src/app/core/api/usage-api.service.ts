import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { StudioUsageReportDto } from '@robdev/shared';
import type { Observable } from 'rxjs';
import { API_PATHS } from './api-paths';

@Injectable({ providedIn: 'root' })
export class UsageApiService {
  private readonly http = inject(HttpClient);

  getOverview(studioId: string, days = 14): Observable<StudioUsageReportDto> {
    const params = new HttpParams().set('days', String(days));
    return this.http.get<StudioUsageReportDto>(API_PATHS.usage.overview(studioId), { params });
  }
}
