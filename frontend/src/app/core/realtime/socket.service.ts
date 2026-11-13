import { Injectable, inject, signal } from '@angular/core';
import {
  WS_NAMESPACE,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@robdev/shared';
import { Observable, Subject } from 'rxjs';
import { io, type Socket } from 'socket.io-client';
import { AuthStore } from '../auth/auth.store';

@Injectable({ providedIn: 'root' })
export class SocketService {
  private readonly auth = inject(AuthStore);
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
  readonly connection = signal<'disconnected' | 'connecting' | 'connected'>('disconnected');
  private readonly reconnected$ = new Subject<void>();
  readonly onReconnect$ = this.reconnected$.asObservable();

  connect(): void {
    if (this.socket) return;
    this.connection.set('connecting');
    this.socket = io(WS_NAMESPACE, {
      path: '/socket.io',
      transports: ['websocket'],
      withCredentials: true,
      auth: (cb) => cb({ token: this.auth.accessToken() }),
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });
    let everConnected = false;
    this.socket.on('connect', () => {
      this.connection.set('connected');
      if (everConnected) this.reconnected$.next();
      everConnected = true;
    });
    this.socket.on('disconnect', () => this.connection.set('disconnected'));
    this.socket.on('connect_error', async (err: Error) => {
      const msg = (err?.message ?? '').toLowerCase();
      // Only trigger an HTTP auth refresh if the server rejected the token (not on raw transport/proxy disconnect)
      if (
        msg.includes('unauthorized') ||
        msg.includes('jwt') ||
        msg.includes('token') ||
        msg.includes('auth')
      ) {
        await this.auth.refresh();
      }
    });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.connection.set('disconnected');
  }

  on<E extends keyof ServerToClientEvents>(
    event: E,
  ): Observable<Parameters<ServerToClientEvents[E]>[0]> {
    return new Observable((sub) => {
      const handler = ((payload: Parameters<ServerToClientEvents[E]>[0]) =>
        sub.next(payload)) as never;
      this.socket?.on(event, handler);
      return () => {
        this.socket?.off(event, handler);
      };
    });
  }

  emitWithAck<E extends keyof ClientToServerEvents>(
    event: E,
    payload: Parameters<ClientToServerEvents[E]>[0],
  ): Promise<unknown> {
    if (!this.socket) {
      return Promise.resolve(undefined);
    }
    return new Promise((resolve, reject) => {
      (this.socket!.timeout(8000).emit as (
        ev: E,
        data: Parameters<ClientToServerEvents[E]>[0],
        cb: (err: Error | null, res?: { ok: boolean; data?: unknown; message?: string }) => void,
      ) => void)(event, payload, (err, res) => {
        if (err) {
          reject(err);
        } else if (res?.ok) {
          resolve(res.data);
        } else {
          reject(new Error(res?.message ?? 'Socket ack failed'));
        }
      });
    });
  }
}
