import {
  HttpErrorResponse,
  type HttpHandlerFn,
  type HttpInterceptorFn,
  type HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { AuthStore } from './auth.store';

function shouldAttachToken(url: string): boolean {
  if (!url.startsWith('/api/')) return false;
  if (url.startsWith('/api/auth/')) return false;
  if (url.startsWith('/api/media/')) return false;
  return true;
}

function withAuth(req: HttpRequest<unknown>, token: string | null): HttpRequest<unknown> {
  if (!token) {
    return req.clone({ withCredentials: true });
  }
  return req.clone({
    withCredentials: true,
    setHeaders: {
      Authorization: `Bearer ${token}`,
    },
  });
}

export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
) => {
  if (!shouldAttachToken(req.url)) {
    return next(req);
  }

  const authStore = inject(AuthStore);
  const router = inject(Router);
  const initialReq = withAuth(req, authStore.accessToken());

  return next(initialReq).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
        return throwError(() => error);
      }

      return from(authStore.refresh()).pipe(
        switchMap((refreshed) => {
          if (refreshed && authStore.accessToken()) {
            const retried = withAuth(req, authStore.accessToken());
            return next(retried);
          }
          const returnUrl = router.url && !router.url.startsWith('/login') ? router.url : '/';
          void router.navigate(['/login'], { queryParams: { returnUrl } });
          return throwError(() => error);
        }),
      );
    }),
  );
};
