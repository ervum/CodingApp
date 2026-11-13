import { HttpStatus } from '@nestjs/common';
import type { ApiErrorBody, ErrorCode } from '@robdev/shared';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly status: HttpStatus | number,
    message: string,
    public readonly details?: ApiErrorBody['details'],
  ) {
    super(message);
    this.name = 'AppError';
  }
}
