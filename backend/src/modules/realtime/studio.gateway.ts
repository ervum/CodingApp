import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  MARKET_ROOM,
  WS_NAMESPACE,
  runRoom,
  studioRoom,
  type Ack,
  type ClientToServerEvents,
  type IsoDateString,
  type ServerToClientEvents,
  type SocketData,
} from '@robdev/shared';
import type { Namespace, Socket } from 'socket.io';
import { AppConfigService } from '../../config/app-config.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { authenticateSocket } from './ws-auth.js';

type StudioSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

@WebSocketGateway({
  namespace: WS_NAMESPACE,
  cors: {
    origin: process.env['FRONTEND_ORIGIN'] || 'http://localhost:4200',
    credentials: true,
  },
})
export class StudioGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server?: Namespace<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >;

  private readonly authPromises = new WeakMap<StudioSocket, Promise<SocketData | null>>();

  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private ensureAuthenticated(socket: StudioSocket): Promise<SocketData | null> {
    const existing = this.authPromises.get(socket);
    if (existing) {
      return existing;
    }
    const promise = (async () => {
      const data = await authenticateSocket(socket, this.jwt, this.config, this.prisma);
      if (data) {
        socket.data.userId = data.userId;
        socket.data.displayName = data.displayName;
        socket.data.studioIds = data.studioIds;
      }
      return data;
    })();
    this.authPromises.set(socket, promise);
    return promise;
  }

  async handleConnection(socket: StudioSocket): Promise<void> {
    const data = await this.ensureAuthenticated(socket);
    if (!data) {
      socket.disconnect(true);
      return;
    }
    await socket.join(MARKET_ROOM);
  }

  handleDisconnect(_socket: StudioSocket): void {
    // socket.io cleans up rooms automatically
  }

  @SubscribeMessage('studio:join')
  async handleStudioJoin(
    @ConnectedSocket() socket: StudioSocket,
    @MessageBody() payload: { studioId: string },
  ): Promise<Parameters<Ack<{ joinedAt: IsoDateString }>>[0]> {
    await this.ensureAuthenticated(socket);
    const allowed = socket.data.studioIds ?? [];
    if (!payload?.studioId || !allowed.includes(payload.studioId)) {
      return { ok: false, code: 'FORBIDDEN', message: 'Not a member of this studio' };
    }
    await socket.join(studioRoom(payload.studioId));
    return { ok: true, data: { joinedAt: new Date().toISOString() } };
  }

  @SubscribeMessage('studio:leave')
  async handleStudioLeave(
    @ConnectedSocket() socket: StudioSocket,
    @MessageBody() payload: { studioId: string },
  ): Promise<Parameters<Ack>[0]> {
    if (payload?.studioId) {
      await socket.leave(studioRoom(payload.studioId));
    }
    return { ok: true, data: undefined };
  }

  @SubscribeMessage('run:subscribe')
  async handleRunSubscribe(
    @ConnectedSocket() socket: StudioSocket,
    @MessageBody() payload: { studioId: string; runId: string },
  ): Promise<Parameters<Ack<{ lastSeq: number }>>[0]> {
    await this.ensureAuthenticated(socket);
    const allowed = socket.data.studioIds ?? [];
    if (!payload?.studioId || !payload?.runId || !allowed.includes(payload.studioId)) {
      return { ok: false, code: 'FORBIDDEN', message: 'Not authorized for this studio' };
    }

    const run = await this.prisma.agentRun.findFirst({
      where: { id: payload.runId, studioId: payload.studioId },
      select: { id: true },
    });
    if (!run) {
      return { ok: false, code: 'NOT_FOUND', message: 'Run not found' };
    }

    const maxEntry = await this.prisma.runLogEntry.aggregate({
      where: { runId: payload.runId },
      _max: { seq: true },
    });
    await socket.join(runRoom(payload.runId));
    return { ok: true, data: { lastSeq: maxEntry._max.seq ?? 0 } };
  }

  @SubscribeMessage('run:unsubscribe')
  async handleRunUnsubscribe(
    @ConnectedSocket() socket: StudioSocket,
    @MessageBody() payload: { runId: string },
  ): Promise<Parameters<Ack>[0]> {
    if (payload?.runId) {
      await socket.leave(runRoom(payload.runId));
    }
    return { ok: true, data: undefined };
  }
}
