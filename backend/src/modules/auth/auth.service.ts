import { randomBytes } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  AuthSessionDto,
  LoginRequest,
  MeDto,
  MembershipDto,
  RegisterRequest,
  UserDto,
} from '@robdev/shared';
import { AppError } from '../../common/errors/app-error.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { provisionStudio } from '../studios/provision-studio.js';
import { PasswordService } from './password.service.js';
import { TokenService, type RefreshTokenClientMeta } from './token.service.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  async register(
    body: RegisterRequest,
    meta: RefreshTokenClientMeta,
  ): Promise<{ session: AuthSessionDto; refreshToken: string }> {
    if (!this.config.allowRegistration) {
      throw new AppError(
        'REGISTRATION_DISABLED',
        HttpStatus.FORBIDDEN,
        'New user registration is disabled',
      );
    }

    const email = body.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new AppError('CONFLICT', HttpStatus.CONFLICT, 'Email address is already registered');
    }

    const passwordHash = await this.passwords.hash(body.password);
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        displayName: body.displayName.trim(),
        avatarColor: '#7C3AED',
      },
    });

    if (body.studioName) {
      const slug = await this.buildUniqueStudioSlug(body.studioName);
      const studio = await this.prisma.studio.create({
        data: {
          slug,
          name: body.studioName,
          workspaceLabel: `robdev / ${body.studioName} studio`,
          isPaused: !this.config.orchestratorAutostart,
        },
      });
      await this.prisma.studioMembership.create({
        data: {
          studioId: studio.id,
          userId: user.id,
          role: 'OWNER',
        },
      });
      await provisionStudio(this.prisma, studio.id);
    }

    await this.ensureDefaultStudioMembership(user.id);

    const memberships = await this.loadMemberships(user.id);
    const { accessToken, accessTokenExpiresAt } = await this.tokens.issueAccessToken(user);
    const { rawToken } = await this.tokens.issueRefreshToken(user.id, meta);

    return {
      session: {
        accessToken,
        accessTokenExpiresAt,
        user: this.toUserDto(user),
        memberships,
      },
      refreshToken: rawToken,
    };
  }

  async login(
    body: LoginRequest,
    meta: RefreshTokenClientMeta,
  ): Promise<{ session: AuthSessionDto; refreshToken: string }> {
    const email = body.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    const valid = await this.passwords.verify(user?.passwordHash, body.password);

    if (!user || !valid) {
      throw new AppError(
        'INVALID_CREDENTIALS',
        HttpStatus.UNAUTHORIZED,
        'Invalid email or password',
      );
    }

    await this.ensureDefaultStudioMembership(user.id);
    const memberships = await this.loadMemberships(user.id);
    const { accessToken, accessTokenExpiresAt } = await this.tokens.issueAccessToken(user);
    const { rawToken } = await this.tokens.issueRefreshToken(user.id, meta);

    return {
      session: {
        accessToken,
        accessTokenExpiresAt,
        user: this.toUserDto(user),
        memberships,
      },
      refreshToken: rawToken,
    };
  }

  async refresh(
    rawToken: string | undefined,
    meta: RefreshTokenClientMeta,
  ): Promise<{ session: AuthSessionDto; refreshToken: string }> {
    if (!rawToken) {
      throw new AppError('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED, 'Missing refresh token cookie');
    }

    const rotated = await this.tokens.rotateRefreshToken(rawToken, meta);
    const user = await this.prisma.user.findUnique({ where: { id: rotated.userId } });
    if (!user) {
      throw new AppError('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED, 'User not found');
    }

    const memberships = await this.loadMemberships(user.id);
    const { accessToken, accessTokenExpiresAt } = await this.tokens.issueAccessToken(user);

    return {
      session: {
        accessToken,
        accessTokenExpiresAt,
        user: this.toUserDto(user),
        memberships,
      },
      refreshToken: rotated.rawToken,
    };
  }

  async logout(rawToken: string | undefined): Promise<void> {
    await this.tokens.revokeRefreshToken(rawToken);
  }

  async me(userId: string): Promise<MeDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppError('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED, 'User not found');
    }
    const memberships = await this.loadMemberships(user.id);
    return {
      user: this.toUserDto(user),
      memberships,
    };
  }

  private async ensureDefaultStudioMembership(userId: string): Promise<void> {
    const existingCount = await this.prisma.studioMembership.count({ where: { userId } });
    const defaultStudio =
      (await this.prisma.studio.findUnique({ where: { slug: 'inclined-games' } })) ??
      (await this.prisma.studio.findFirst({ orderBy: { createdAt: 'asc' } }));

    if (defaultStudio) {
      await this.prisma.studioMembership.upsert({
        where: {
          studioId_userId: {
            studioId: defaultStudio.id,
            userId,
          },
        },
        update: {},
        create: {
          studioId: defaultStudio.id,
          userId,
          role: 'OWNER',
        },
      });
      return;
    }

    if (existingCount === 0) {
      const slug = await this.buildUniqueStudioSlug('RoAutomation');
      const studio = await this.prisma.studio.create({
        data: {
          slug,
          name: 'RoAutomation',
          workspaceLabel: 'RoAutomation',
          isPaused: !this.config.orchestratorAutostart,
        },
      });
      await this.prisma.studioMembership.create({
        data: {
          studioId: studio.id,
          userId,
          role: 'OWNER',
        },
      });
      await provisionStudio(this.prisma, studio.id);
    }
  }

  private async loadMemberships(userId: string): Promise<MembershipDto[]> {
    const rows = await this.prisma.studioMembership.findMany({
      where: { userId },
      include: { studio: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({
      studioId: row.studio.id,
      studioSlug: row.studio.slug,
      studioName: row.studio.name,
      workspaceLabel: row.studio.workspaceLabel,
      role: row.role,
    }));
  }

  private toUserDto(user: {
    id: string;
    email: string;
    displayName: string;
    avatarColor: string;
    createdAt: Date;
  }): UserDto {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarColor: user.avatarColor,
      createdAt: user.createdAt.toISOString(),
    };
  }

  private async buildUniqueStudioSlug(studioName: string): Promise<string> {
    const base = studioName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 34);
    const candidateBase = base.length >= 3 ? base : `studio-${base}`;
    const collision = await this.prisma.studio.findUnique({ where: { slug: candidateBase } });
    if (!collision) {
      return candidateBase;
    }
    const suffix = randomBytes(2).toString('hex');
    return `${candidateBase}-${suffix}`;
  }
}
