import { Injectable } from '@nestjs/common';
import type { RunAbortReason } from './run-errors.js';

export interface ActiveRunHandle {
  readonly runId: string;
  readonly studioId: string | null;
  readonly agentId: string | null;
  readonly signal: AbortSignal;
  readonly reason: RunAbortReason | null;
  abort(reason: RunAbortReason): void;
}

interface InternalEntry {
  runId: string;
  studioId: string | null;
  agentId: string | null;
  controller: AbortController;
  reason: RunAbortReason | null;
}

@Injectable()
export class RunRegistryService {
  private readonly active = new Map<string, InternalEntry>();

  register(
    runId: string,
    meta?: { studioId?: string | null; agentId?: string | null },
  ): ActiveRunHandle {
    const controller = new AbortController();
    const entry: InternalEntry = {
      runId,
      studioId: meta?.studioId ?? null,
      agentId: meta?.agentId ?? null,
      controller,
      reason: null,
    };
    this.active.set(runId, entry);

    return {
      runId,
      studioId: entry.studioId,
      agentId: entry.agentId,
      signal: controller.signal,
      get reason() {
        return entry.reason;
      },
      abort: (reason: RunAbortReason) => {
        if (!entry.controller.signal.aborted) {
          entry.reason = reason;
          entry.controller.abort(reason);
        }
      },
    };
  }

  setMeta(runId: string, meta: { studioId: string; agentId: string }): void {
    const entry = this.active.get(runId);
    if (entry) {
      entry.studioId = meta.studioId;
      entry.agentId = meta.agentId;
    }
  }

  unregister(runId: string): void {
    this.active.delete(runId);
  }

  isActive(runId: string): boolean {
    return this.active.has(runId);
  }

  hasActiveRunForAgent(agentId: string): boolean {
    for (const entry of this.active.values()) {
      if (entry.agentId === agentId) {
        return true;
      }
    }
    return false;
  }

  activeCount(studioId: string): number {
    let count = 0;
    for (const entry of this.active.values()) {
      if (entry.studioId === studioId) {
        count++;
      }
    }
    return count;
  }

  abort(runId: string, reason: RunAbortReason): boolean {
    const entry = this.active.get(runId);
    if (!entry) {
      return false;
    }
    if (!entry.controller.signal.aborted) {
      entry.reason = reason;
      entry.controller.abort(reason);
    }
    return true;
  }

  abortAllForStudio(studioId: string, reason: RunAbortReason): void {
    for (const entry of this.active.values()) {
      if (entry.studioId === studioId && !entry.controller.signal.aborted) {
        entry.reason = reason;
        entry.controller.abort(reason);
      }
    }
  }
}
