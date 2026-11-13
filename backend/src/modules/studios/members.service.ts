import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  AddMemberRequest,
  MemberDto,
  MembershipRole,
  UpdateMemberRequest,
} from '@robdev/shared';
import { AppError } from '../../common/errors/app-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class MembersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(studioId: string): Promise<MemberDto[]> {
    const rows = await this.prisma.studioMembership.findMany({
      where: { studioId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            avatarColor: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((r) => ({
      userId: r.user.id,
      email: r.user.email,
      displayName: r.user.displayName,
      avatarColor: r.user.avatarColor,
      role: r.role,
      joinedAt: r.createdAt.toISOString(),
    }));
  }

  async add(studioId: string, body: AddMemberRequest): Promise<MemberDto> {
    const email = body.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        displayName: true,
        avatarColor: true,
      },
    });
    if (!user) {
      throw new AppError(
        'NOT_FOUND',
        HttpStatus.NOT_FOUND,
        `No user found with email ${body.email}`,
      );
    }

    const existing = await this.prisma.studioMembership.findUnique({
      where: {
        studioId_userId: {
          studioId,
          userId: user.id,
        },
      },
    });
    if (existing) {
      throw new AppError(
        'CONFLICT',
        HttpStatus.CONFLICT,
        'User is already a member of this studio',
      );
    }

    const created = await this.prisma.studioMembership.create({
      data: {
        studioId,
        userId: user.id,
        role: body.role,
      },
    });

    return {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarColor: user.avatarColor,
      role: created.role,
      joinedAt: created.createdAt.toISOString(),
    };
  }

  async updateRole(
    studioId: string,
    targetUserId: string,
    body: UpdateMemberRequest,
    callerRole: MembershipRole,
  ): Promise<MemberDto> {
    const existing = await this.prisma.studioMembership.findUnique({
      where: {
        studioId_userId: {
          studioId,
          userId: targetUserId,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            avatarColor: true,
          },
        },
      },
    });

    if (!existing) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Studio member not found');
    }

    if (
      (existing.role === 'OWNER' || body.role === 'OWNER') &&
      callerRole !== 'OWNER'
    ) {
      throw new AppError(
        'FORBIDDEN',
        HttpStatus.FORBIDDEN,
        'Only an OWNER can grant or revoke the OWNER role',
      );
    }

    if (existing.role === 'OWNER' && body.role !== 'OWNER') {
      const ownerCount = await this.prisma.studioMembership.count({
        where: { studioId, role: 'OWNER' },
      });
      if (ownerCount <= 1) {
        throw new AppError(
          'CONFLICT',
          HttpStatus.CONFLICT,
          'Cannot demote the last OWNER of a studio',
        );
      }
    }

    const updated = await this.prisma.studioMembership.update({
      where: { id: existing.id },
      data: { role: body.role },
    });

    return {
      userId: existing.user.id,
      email: existing.user.email,
      displayName: existing.user.displayName,
      avatarColor: existing.user.avatarColor,
      role: updated.role,
      joinedAt: existing.createdAt.toISOString(),
    };
  }

  async remove(
    studioId: string,
    targetUserId: string,
    callerRole: MembershipRole,
  ): Promise<void> {
    const existing = await this.prisma.studioMembership.findUnique({
      where: {
        studioId_userId: {
          studioId,
          userId: targetUserId,
        },
      },
    });

    if (!existing) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Studio member not found');
    }

    if (existing.role === 'OWNER') {
      if (callerRole !== 'OWNER') {
        throw new AppError(
          'FORBIDDEN',
          HttpStatus.FORBIDDEN,
          'Only an OWNER can remove another OWNER',
        );
      }
      const ownerCount = await this.prisma.studioMembership.count({
        where: { studioId, role: 'OWNER' },
      });
      if (ownerCount <= 1) {
        throw new AppError(
          'CONFLICT',
          HttpStatus.CONFLICT,
          'Cannot remove the last OWNER of a studio',
        );
      }
    }

    await this.prisma.studioMembership.delete({
      where: { id: existing.id },
    });
  }
}
