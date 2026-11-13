import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type {
  AuthSessionDto,
  LoginRequest,
  MembershipDto,
  RegisterRequest,
  UserDto,
} from '@robdev/shared';
import { firstValueFrom } from 'rxjs';
import { AuthApiService } from './auth-api.service';

@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly api = inject(AuthApiService);
  private readonly router = inject(Router);

  readonly accessToken = signal<string | null>(null);
  readonly user = signal<UserDto | null>(null);
  readonly memberships = signal<MembershipDto[]>([]);
  readonly isAuthenticated = computed(() => this.accessToken() !== null);

  private refreshInFlight: Promise<boolean> | null = null;

  async restoreSession(): Promise<void> {
    await this.refresh();
  }

  applySession(s: AuthSessionDto): void {
    this.accessToken.set(s.accessToken);
    this.user.set(s.user);
    this.memberships.set(s.memberships);
  }

  /** Single-flight refresh shared by interceptor + socket reconnect. */
  refresh(): Promise<boolean> {
    this.refreshInFlight ??= firstValueFrom(this.api.refresh())
      .then((s) => {
        this.applySession(s);
        return true;
      })
      .catch((err: unknown) => {
        if (
          err instanceof HttpErrorResponse &&
          (err.status === 401 || err.status === 403)
        ) {
          this.clear();
        }
        return false;
      })
      .finally(() => {
        this.refreshInFlight = null;
      });
    return this.refreshInFlight;
  }

  async login(body: LoginRequest): Promise<void> {
    this.applySession(await firstValueFrom(this.api.login(body)));
  }

  async register(body: RegisterRequest): Promise<void> {
    this.applySession(await firstValueFrom(this.api.register(body)));
  }

  async logout(): Promise<void> {
    await firstValueFrom(this.api.logout()).catch(() => undefined);
    this.clear();
    await this.router.navigateByUrl('/login');
  }

  clear(): void {
    this.accessToken.set(null);
    this.user.set(null);
    this.memberships.set([]);
  }
}
