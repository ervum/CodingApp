import {
  HttpErrorResponse,
  type HttpHandlerFn,
  type HttpInterceptorFn,
  type HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import type { ApiErrorBody } from '@robdev/shared';
import { catchError, throwError } from 'rxjs';
import { ToastService } from '../../shared/ui/toast/toast.service';

function extractApiError(err: HttpErrorResponse): ApiErrorBody | null {
  const payload = err.error as unknown;
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'code' in payload &&
    'message' in payload &&
    typeof (payload as Record<string, unknown>)['code'] === 'string' &&
    typeof (payload as Record<string, unknown>)['message'] === 'string'
  ) {
    return payload as ApiErrorBody;
  }
  return null;
}

export const apiErrorInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
) => {
  const toast = inject(ToastService);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse) {
        const apiErr = extractApiError(error);
        const isAuthRefresh = req.url.startsWith('/api/auth/refresh');
        const is401 = error.status === 401;
        const isVersionConflict = error.status === 409 && apiErr?.code === 'VERSION_CONFLICT';
        const isDetailGet404 = req.method === 'GET' && error.status === 404;

        if (!isAuthRefresh && !is401 && !isVersionConflict && !isDetailGet404) {
          toast.error(apiErr?.message ?? error.message ?? 'Request failed');
        }
      }
      return throwError(() => error);
    }),
  );
};
