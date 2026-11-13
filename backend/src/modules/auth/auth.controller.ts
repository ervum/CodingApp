import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  LoginRequestSchema,
  RegisterRequestSchema,
  type AuthSessionDto,
  type LoginRequest,
  type MeDto,
  type RegisterRequest,
} from '@robdev/shared';
import type { Request, Response } from 'express';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { AuthService } from './auth.service.js';

export const REFRESH_COOKIE_NAME = 'rd_refresh';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfigService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('register')
  async register(
    @Body(new ZodValidationPipe(RegisterRequestSchema)) body: RegisterRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionDto> {
    const { session, refreshToken } = await this.auth.register(body, {
      userAgent: req.headers['user-agent'] ?? null,
      ip: req.ip ?? null,
    });
    this.setRefreshCookie(res, refreshToken);
    return session;
  }

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(LoginRequestSchema)) body: LoginRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionDto> {
    const { session, refreshToken } = await this.auth.login(body, {
      userAgent: req.headers['user-agent'] ?? null,
      ip: req.ip ?? null,
    });
    this.setRefreshCookie(res, refreshToken);
    return session;
  }

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionDto> {
    const rawCookie = (req.cookies as Record<string, string | undefined> | undefined)?.[
      REFRESH_COOKIE_NAME
    ];
    const { session, refreshToken } = await this.auth.refresh(rawCookie, {
      userAgent: req.headers['user-agent'] ?? null,
      ip: req.ip ?? null,
    });
    this.setRefreshCookie(res, refreshToken);
    return session;
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const rawCookie = (req.cookies as Record<string, string | undefined> | undefined)?.[
      REFRESH_COOKIE_NAME
    ];
    await this.auth.logout(rawCookie);
    this.clearRefreshCookie(res);
  }

  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser): Promise<MeDto> {
    return this.auth.me(user.id);
  }

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/api/auth',
      secure: this.config.cookieSecure,
      maxAge: this.config.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/api/auth',
      secure: this.config.cookieSecure,
    });
  }
}
