import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  LeaderboardQuery,
  MarketHistoryPointDto,
  MarketIngestionRunDto,
  MarketLeaderboardDto,
} from '@robdev/shared';
import type { Observable } from 'rxjs';
import { API_PATHS } from './api-paths';

@Injectable({ providedIn: 'root' })
export class MarketApiService {
  private readonly http = inject(HttpClient);

  leaderboard(query?: Partial<LeaderboardQuery>): Observable<MarketLeaderboardDto> {
    let params = new HttpParams();
    if (query?.sort) params = params.set('sort', query.sort);
    if (query?.genre) params = params.set('genre', query.genre);
    if (query?.search) params = params.set('search', query.search);
    if (query?.limit !== undefined) params = params.set('limit', String(query.limit));
    return this.http.get<MarketLeaderboardDto>(API_PATHS.market.leaderboard(), { params });
  }

  history(universeId: string, days = 8): Observable<MarketHistoryPointDto[]> {
    const params = new HttpParams().set('days', String(days));
    return this.http.get<MarketHistoryPointDto[]>(API_PATHS.market.history(universeId), { params });
  }

  ingestionRuns(): Observable<MarketIngestionRunDto[]> {
    return this.http.get<MarketIngestionRunDto[]>(API_PATHS.market.ingestionRuns());
  }

  refresh(): Observable<MarketIngestionRunDto> {
    return this.http.post<MarketIngestionRunDto>(API_PATHS.market.refresh(), {});
  }
}
