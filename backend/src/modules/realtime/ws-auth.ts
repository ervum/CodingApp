import type { JwtService } from '@nestjs/jwt';
import type { AccessTokenClaims, SocketData } from '@robdev/shared';
import type { Socket } from 'socket.io';
import type { AppConfigService } from '../../config/app-config.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

export async function authenticateSocket(
  socket: Socket,
  jwt: JwtService,
  config: AppConfigService,
  prisma: PrismaService,
): Promise<SocketData | null> {
  const rawToken = socket.handshake.auth?.['token'] as unknown;
  if (typeof rawToken !== 'string' || rawToken.trim().length === 0) {
    return null;
  }

  try {
    const claims = await jwt.verifyAsync<AccessTokenClaims>(rawToken.trim(), {
      secret: config.jwtAccessSecret,
    });
    const memberships = await prisma.studioMembership.findMany({
      where: { userId: claims.sub },
      select: { studioId: true },
    });
    return {
      userId: claims.sub,
      displayName: claims.name,
      studioIds: memberships.map((m) => m.studioId),
    };
  } catch {
    return null;
  }
}
