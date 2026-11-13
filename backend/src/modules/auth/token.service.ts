import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppError } from '../../common/errors/app-error.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface RefreshTokenClientMeta {
  userAgent?: string | null;
  ip?: string | null;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async issueAccessToken(user: {
    id: string;
    email: string;
    displayName: string;
  }): Promise<{ accessToken: string; accessTokenExpiresAt: string }> {
    const ttlSeconds = this.config.jwtAccessTtlSeconds;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        email: user.email,
        name: user.displayName,
      },
      {
        secret: this.config.jwtAccessSecret,
        expiresIn: ttlSeconds,
      },
    );
    return {
      accessToken,
      accessTokenExpiresAt: expiresAt,
    };
  }

  async issueRefreshToken(
    userId: string,
    meta: RefreshTokenClientMeta & { familyId?: string } = {},
  ): Promise<{ rawToken: string; tokenId: string; familyId: string }> {
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hashRefreshToken(rawToken);
    const familyId = meta.familyId ?? randomUUID();
    const expiresAt = new Date(
      Date.now() + this.config.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    );

    const record = await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        familyId,
        userAgent: meta.userAgent ?? null,
        expiresAt,
      },
    });

    return { rawToken, tokenId: record.id, familyId };
  }

  async rotateRefreshToken(
    rawToken: string,
    meta: RefreshTokenClientMeta = {},
  ): Promise<{ rawToken: string; userId: string }> {
    const tokenHash = this.hashRefreshToken(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!existing) {
      throw new AppError('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED, 'Invalid refresh token');
    }

    if (existing.revokedAt !== null) {
      // Reuse detection: revoke all tokens in the same family
      await this.prisma.refreshToken.updateMany({
        where: { familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new AppError(
        'UNAUTHENTICATED',
        HttpStatus.UNAUTHORIZED,
        'Refresh token reuse detected; session family revoked',
      );
    }

    if (existing.expiresAt.getTime() <= Date.now()) {
      await this.prisma.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
      });
      throw new AppError('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED, 'Refresh token expired');
    }

    const newRawToken = randomBytes(32).toString('base64url');
    const newTokenHash = this.hashRefreshToken(newRawToken);
    const expiresAt = new Date(
      Date.now() + this.config.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    );

    await this.prisma.$transaction(async (tx) => {
      const created = await tx.refreshToken.create({
        data: {
          userId: existing.userId,
          tokenHash: newTokenHash,
          familyId: existing.familyId,
          userAgent: meta.userAgent ?? null,
          expiresAt,
        },
      });
      await tx.refreshToken.update({
        where: { id: existing.id },
        data: {
          revokedAt: new Date(),
          replacedById: created.id,
        },
      });
    });

    return {
      rawToken: newRawToken,
      userId: existing.userId,
    };
  }

  async revokeRefreshToken(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const tokenHash = this.hashRefreshToken(rawToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private hashRefreshToken(rawToken: string): string {
    return createHash('sha256').update(rawToken, 'utf8').digest('hex');
  }
}
