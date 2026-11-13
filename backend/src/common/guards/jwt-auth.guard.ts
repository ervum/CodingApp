import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { AccessTokenClaims } from '@robdev/shared';
import { AppConfigService } from '../../config/app-config.service.js';
import type { RequestWithUser } from '../decorators/current-user.decorator.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { AppError } from '../errors/app-error.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() === 'ws') {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED, 'Missing bearer token');
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      throw new AppError('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED, 'Empty bearer token');
    }

    try {
      const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        secret: this.config.jwtAccessSecret,
      });
      req.user = {
        id: claims.sub,
        email: claims.email,
        displayName: claims.name,
      };
      return true;
    } catch {
      throw new AppError('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED, 'Invalid or expired token');
    }
  }
}
