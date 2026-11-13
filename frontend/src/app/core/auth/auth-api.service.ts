import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  AuthSessionDto,
  LoginRequest,
  MeDto,
  RegisterRequest,
} from '@robdev/shared';
import type { Observable } from 'rxjs';
import { API_PATHS } from '../api/api-paths';

@Injectable({ providedIn: 'root' })
export class AuthApiService {
  private readonly http = inject(HttpClient);

  register(body: RegisterRequest): Observable<AuthSessionDto> {
    return this.http.post<AuthSessionDto>(API_PATHS.auth.register(), body, {
      withCredentials: true,
    });
  }

  login(body: LoginRequest): Observable<AuthSessionDto> {
    return this.http.post<AuthSessionDto>(API_PATHS.auth.login(), body, {
      withCredentials: true,
    });
  }

  refresh(): Observable<AuthSessionDto> {
    return this.http.post<AuthSessionDto>(
      API_PATHS.auth.refresh(),
      {},
      { withCredentials: true },
    );
  }

  logout(): Observable<void> {
    return this.http.post<void>(
      API_PATHS.auth.logout(),
      {},
      { withCredentials: true },
    );
  }

  me(): Observable<MeDto> {
    return this.http.get<MeDto>(API_PATHS.auth.me(), {
      withCredentials: true,
    });
  }
}
