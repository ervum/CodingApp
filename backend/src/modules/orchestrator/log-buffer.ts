import { Injectable } from '@nestjs/common';
import type {
  AgentKey,
  LogEntryKind,
  RunLogEntryDto,
  RunLogMeta,
} from '@robdev/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

export interface LogBufferDeps {
  createEntry: (data: {
    runId: string;
    seq: number;
    kind: LogEntryKind;
    content: string;
    meta: RunLogMeta | null;
  }) => Promise<{ id: string; createdAt: Date }>;
  updateEntryContent: (id: string, content: string) => Promise<void>;
  updateEntryContentAndMeta?: (
    id: string,
    content: string,
    meta: RunLogMeta | null,
  ) => Promise<void>;
  emitLogChunk: (payload: {
    runId: string;
    agentKey: AgentKey;
    entryId: string;
    seq: number;
    kind: LogEntryKind;
    delta: string | null;
    entry: RunLogEntryDto | null;
    meta: RunLogMeta | null;
  }) => void;
  emitActivity: (payload: {
    agentKey: AgentKey;
    runId: string;
    snippet: string;
  }) => void;
}

export class LogBuffer {
  private nextSeq = 1;
  private openText: {
    id: string;
    seq: number;
    content: string;
    pendingDelta: string;
    createdAt: Date;
    lastPersistedContent: string;
  } | null = null;

  private openThinking: {
    id: string;
    seq: number;
    content: string;
    meta: RunLogMeta;
    createdAt: Date;
    lastPersistedContent: string;
    lastPersistMs: number;
  } | null = null;

  private lastClosedThinking: {
    id: string;
    seq: number;
    content: string;
    meta: RunLogMeta;
    createdAt: Date;
    lastPersistedContent: string;
    lastPersistMs: number;
  } | null = null;

  private deltaTimer: NodeJS.Timeout | null = null;
  private persistTimer: NodeJS.Timeout | null = null;
  private lastActivityEmitMs = 0;

  constructor(
    private readonly runId: string,
    private readonly agentKey: AgentKey,
    private readonly deps: LogBufferDeps,
    initialNextSeq = 1,
  ) {
    this.nextSeq = Math.max(1, initialNextSeq);
  }

  async updateThinking(
    text: string,
    startedAt: string,
    durationMs: number,
    done: boolean,
  ): Promise<void> {
    const meta: RunLogMeta = {
      isThinking: true,
      thinkingStartedAt: startedAt,
      thinkingDurationMs: Math.max(0, Math.round(durationMs)),
      thinkingFinished: done,
    };

    if (!this.openThinking && this.lastClosedThinking && text.trim().length > 0) {
      this.openThinking = this.lastClosedThinking;
    }

    if (!this.openThinking) {
      const seq = this.nextSeq++;
      const created = await this.deps.createEntry({
        runId: this.runId,
        seq,
        kind: 'SYSTEM',
        content: text,
        meta,
      });
      this.openThinking = {
        id: created.id,
        seq,
        content: text,
        meta,
        createdAt: created.createdAt,
        lastPersistedContent: text,
        lastPersistMs: Date.now(),
      };

      const dto: RunLogEntryDto = {
        id: created.id,
        runId: this.runId,
        seq,
        kind: 'SYSTEM',
        content: text,
        meta,
        createdAt: created.createdAt.toISOString(),
      };
      this.deps.emitLogChunk({
        runId: this.runId,
        agentKey: this.agentKey,
        entryId: created.id,
        seq,
        kind: 'SYSTEM',
        delta: null,
        entry: dto,
        meta,
      });

      if (done) {
        this.lastClosedThinking = this.openThinking;
        this.openThinking = null;
      }
      return;
    }

    this.openThinking.content = text;
    this.openThinking.meta = meta;
    const now = Date.now();

    if (
      done ||
      text !== this.openThinking.lastPersistedContent ||
      now - this.openThinking.lastPersistMs >= 800
    ) {
      this.openThinking.lastPersistedContent = text;
      this.openThinking.lastPersistMs = now;
      if (this.deps.updateEntryContentAndMeta) {
        await this.deps.updateEntryContentAndMeta(
          this.openThinking.id,
          text,
          meta,
        );
      } else {
        await this.deps.updateEntryContent(this.openThinking.id, text);
      }
    }

    const dto: RunLogEntryDto = {
      id: this.openThinking.id,
      runId: this.runId,
      seq: this.openThinking.seq,
      kind: 'SYSTEM',
      content: text,
      meta,
      createdAt: this.openThinking.createdAt.toISOString(),
    };
    this.deps.emitLogChunk({
      runId: this.runId,
      agentKey: this.agentKey,
      entryId: this.openThinking.id,
      seq: this.openThinking.seq,
      kind: 'SYSTEM',
      delta: null,
      entry: dto,
      meta,
    });

    if (done) {
      this.lastClosedThinking = this.openThinking;
      this.openThinking = null;
    }
  }

  async closeThinking(): Promise<void> {
    if (!this.openThinking) return;
    const cur = this.openThinking;
    const startMs = cur.meta.thinkingStartedAt
      ? Date.parse(cur.meta.thinkingStartedAt)
      : cur.createdAt.getTime();
    const finalDur = Math.max(
      cur.meta.thinkingDurationMs ?? 0,
      Date.now() - (Number.isFinite(startMs) ? startMs : Date.now()),
    );
    await this.updateThinking(
      cur.content,
      cur.meta.thinkingStartedAt ?? cur.createdAt.toISOString(),
      finalDur,
      true,
    );
  }

  async appendText(text: string, replace = false): Promise<void> {
    if (!text && (!replace || !this.openText)) return;
    if (this.openThinking) {
      await this.closeThinking();
    }

    if (!this.openText) {
      const seq = this.nextSeq++;
      const created = await this.deps.createEntry({
        runId: this.runId,
        seq,
        kind: 'TEXT',
        content: text,
        meta: null,
      });
      this.openText = {
        id: created.id,
        seq,
        content: text,
        pendingDelta: text,
        createdAt: created.createdAt,
        lastPersistedContent: text,
      };
      this.startPersistLoop();
    } else if (replace) {
      if (this.deltaTimer) {
        clearTimeout(this.deltaTimer);
        this.deltaTimer = null;
      }
      this.openText.content = text;
      this.openText.pendingDelta = '';
      if (this.openText.content !== this.openText.lastPersistedContent) {
        this.openText.lastPersistedContent = this.openText.content;
        void this.deps.updateEntryContent(this.openText.id, this.openText.content);
      }
      const dto: RunLogEntryDto = {
        id: this.openText.id,
        runId: this.runId,
        seq: this.openText.seq,
        kind: 'TEXT',
        content: this.openText.content,
        meta: null,
        createdAt: this.openText.createdAt.toISOString(),
      };
      this.deps.emitLogChunk({
        runId: this.runId,
        agentKey: this.agentKey,
        entryId: this.openText.id,
        seq: this.openText.seq,
        kind: 'TEXT',
        delta: null,
        entry: dto,
        meta: null,
      });
      this.maybeEmitActivity(this.openText.content);
      return;
    } else {
      this.openText.content += text;
      this.openText.pendingDelta += text;
    }

    if (this.openText.pendingDelta.length >= 512) {
      this.flushDelta();
    } else if (!this.deltaTimer) {
      this.deltaTimer = setTimeout(() => {
        this.deltaTimer = null;
        this.flushDelta();
      }, 120);
    }

    this.maybeEmitActivity(this.openText.content);
  }

  async closeText(): Promise<void> {
    if (!this.openText) return;

    if (this.deltaTimer) {
      clearTimeout(this.deltaTimer);
      this.deltaTimer = null;
    }
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
    }

    this.flushDelta();

    const current = this.openText;
    this.openText = null;

    if (current.content !== current.lastPersistedContent) {
      await this.deps.updateEntryContent(current.id, current.content);
      current.lastPersistedContent = current.content;
    }

    const dto: RunLogEntryDto = {
      id: current.id,
      runId: this.runId,
      seq: current.seq,
      kind: 'TEXT',
      content: current.content,
      meta: null,
      createdAt: current.createdAt.toISOString(),
    };

    this.deps.emitLogChunk({
      runId: this.runId,
      agentKey: this.agentKey,
      entryId: current.id,
      seq: current.seq,
      kind: 'TEXT',
      delta: null,
      entry: dto,
      meta: null,
    });
  }

  async entry(
    kind: LogEntryKind,
    content: string,
    meta: RunLogMeta | null = null,
  ): Promise<RunLogEntryDto> {
    if (kind !== 'SYSTEM' && this.openThinking) {
      await this.closeThinking();
    }
    if (kind !== 'SYSTEM') {
      this.lastClosedThinking = null;
    }
    await this.closeText();

    const seq = this.nextSeq++;
    const created = await this.deps.createEntry({
      runId: this.runId,
      seq,
      kind,
      content,
      meta,
    });

    const dto: RunLogEntryDto = {
      id: created.id,
      runId: this.runId,
      seq,
      kind,
      content,
      meta,
      createdAt: created.createdAt.toISOString(),
    };

    this.deps.emitLogChunk({
      runId: this.runId,
      agentKey: this.agentKey,
      entryId: created.id,
      seq,
      kind,
      delta: null,
      entry: dto,
      meta,
    });

    return dto;
  }

  async flushAll(): Promise<void> {
    await this.closeThinking();
    await this.closeText();
  }

  private flushDelta(): void {
    if (!this.openText || this.openText.pendingDelta.length === 0) return;
    const delta = this.openText.pendingDelta;
    this.openText.pendingDelta = '';

    this.deps.emitLogChunk({
      runId: this.runId,
      agentKey: this.agentKey,
      entryId: this.openText.id,
      seq: this.openText.seq,
      kind: 'TEXT',
      delta,
      entry: null,
      meta: null,
    });
  }

  private startPersistLoop(): void {
    if (this.persistTimer) return;
    this.persistTimer = setInterval(() => {
      if (!this.openText) return;
      if (this.openText.content !== this.openText.lastPersistedContent) {
        const id = this.openText.id;
        const content = this.openText.content;
        this.openText.lastPersistedContent = content;
        void this.deps.updateEntryContent(id, content);
      }
    }, 1000);
  }

  private maybeEmitActivity(content: string): void {
    const now = Date.now();
    if (now - this.lastActivityEmitMs < 1000) return;
    this.lastActivityEmitMs = now;
    const collapsed = content.replace(/\s+/g, ' ').trim();
    if (!collapsed) return;
    const snippet = collapsed.slice(-140);
    this.deps.emitActivity({
      agentKey: this.agentKey,
      runId: this.runId,
      snippet,
    });
  }
}

@Injectable()
export class LogBufferFactory {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  create(
    studioId: string,
    runId: string,
    agentKey: AgentKey,
    initialNextSeq = 1,
  ): LogBuffer {
    return new LogBuffer(
      runId,
      agentKey,
      {
        createEntry: async (data) => {
          const row = await this.prisma.runLogEntry.create({
            data: {
              runId: data.runId,
              seq: data.seq,
              kind: data.kind,
              content: data.content,
              ...(data.meta
                ? { meta: data.meta as unknown as Prisma.InputJsonValue }
                : {}),
            },
            select: { id: true, createdAt: true },
          });
          return row;
        },
        updateEntryContent: async (id, content) => {
          await this.prisma.runLogEntry.update({
            where: { id },
            data: { content },
          });
        },
        updateEntryContentAndMeta: async (id, content, meta) => {
          await this.prisma.runLogEntry.update({
            where: { id },
            data: {
              content,
              ...(meta
                ? { meta: meta as unknown as Prisma.InputJsonValue }
                : {}),
            },
          });
        },
        emitLogChunk: (payload) => {
          this.realtime.emitToRun(studioId, runId, payload);
        },
        emitActivity: (payload) => {
          this.realtime.emitToStudio(studioId, 'agent:activity', payload);
        },
      },
      initialNextSeq,
    );
  }
}
