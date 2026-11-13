import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { MembershipRole } from '@robdev/shared';
import type { RequestWithUser } from './current-user.decorator.js';

export interface StudioRequestContext {
  id: string;
  slug: string;
  role: MembershipRole;
}

export interface RequestWithStudio extends RequestWithUser {
  studio?: StudioRequestContext;
}

export const StudioCtx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): StudioRequestContext => {
    const req = ctx.switchToHttp().getRequest<RequestWithStudio>();
    if (!req.studio) {
      throw new Error('StudioCtx decorator used on a route without StudioAccessGuard');
    }
    return req.studio;
  },
);
