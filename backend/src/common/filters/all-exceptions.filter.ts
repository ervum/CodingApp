import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiErrorBody, ErrorCode } from '@robdev/shared';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../errors/app-error.js';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    if (exception instanceof AppError) {
      const body: ApiErrorBody = {
        statusCode: exception.status,
        code: exception.code,
        message: exception.message,
        ...(exception.details !== undefined ? { details: exception.details } : {}),
      };
      res.status(exception.status).json(body);
      return;
    }

    if (exception instanceof ZodError) {
      const details = exception.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      }));
      const body: ApiErrorBody = {
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        details,
      };
      res.status(HttpStatus.BAD_REQUEST).json(body);
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        const body: ApiErrorBody = {
          statusCode: HttpStatus.CONFLICT,
          code: 'CONFLICT',
          message: 'A record with this unique value already exists',
        };
        res.status(HttpStatus.CONFLICT).json(body);
        return;
      }
      if (exception.code === 'P2025') {
        const body: ApiErrorBody = {
          statusCode: HttpStatus.NOT_FOUND,
          code: 'NOT_FOUND',
          message: 'Requested record was not found',
        };
        res.status(HttpStatus.NOT_FOUND).json(body);
        return;
      }
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = this.statusToErrorCode(status);
      const body: ApiErrorBody = {
        statusCode: status,
        code,
        message: exception.message || 'Request failed',
      };
      res.status(status).json(body);
      return;
    }

    const err = exception instanceof Error ? exception : new Error(String(exception));
    this.logger.error(`Unhandled exception: ${err.message}`, err.stack);

    const body: ApiErrorBody = {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL',
      message: 'An unexpected internal error occurred',
    };
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json(body);
  }

  private statusToErrorCode(status: number): ErrorCode {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'VALIDATION_FAILED';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHENTICATED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'RATE_LIMITED';
      default:
        return 'INTERNAL';
    }
  }
}
