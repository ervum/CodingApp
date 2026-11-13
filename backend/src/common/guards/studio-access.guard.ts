import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLE_RANK, type MembershipRole } from '@robdev/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { RequestWithStudio } from '../decorators/studio-context.decorator.js';
import { STUDIO_MIN_ROLE_KEY } from '../decorators/studio-roles.decorator.js';
import { AppError } from '../errors/app-error.js';

@Injectable()
export class StudioAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithStudio>();
    const user = req.user;
    if (!user) {
      throw new AppError('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED, 'Authentication required');
    }

    const rawParam = req.params['studioId'];
    const studioParam = Array.isArray(rawParam) ? rawParam[0] : rawParam;
    if (!studioParam) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Studio not found');
    }

    const membership = await this.prisma.studioMembership.findFirst({
      where: {
        userId: user.id,
        OR: [{ studioId: studioParam }, { studio: { slug: studioParam } }],
      },
      include: { studio: true },
    });

    if (!membership) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Studio not found');
    }

    const minRole =
      this.reflector.getAllAndOverride<MembershipRole>(STUDIO_MIN_ROLE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'VIEWER';

    if (ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
      throw new AppError(
        'FORBIDDEN',
        HttpStatus.FORBIDDEN,
        `Requires studio role ${minRole} or higher`,
      );
    }

    req.params['studioId'] = membership.studio.id;
    req.studio = {
      id: membership.studio.id,
      slug: membership.studio.slug,
      role: membership.role,
    };

    return true;
  }
}
