import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LogBuffer } from './log-buffer.js';

describe('LogBuffer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('assigns strictly increasing seq numbers and batches text deltas on 120ms timer', async () => {
    const createdEntries: Array<{ id: string; seq: number; kind: string; content: string }> = [];
    const chunks: Array<{ seq: number; delta: string | null; entryId: string; finalized: boolean }> = [];
    const activities: string[] = [];

    const buffer = new LogBuffer('run_1', 'builder', {
      createEntry: async (data) => {
        const id = `entry_${data.seq}`;
        createdEntries.push({ id, seq: data.seq, kind: data.kind, content: data.content });
        return { id, createdAt: new Date('2026-10-22T15:00:00Z') };
      },
      updateEntryContent: async () => {},
      emitLogChunk: (p) => {
        chunks.push({
          seq: p.seq,
          delta: p.delta,
          entryId: p.entryId,
          finalized: p.entry !== null,
        });
      },
      emitActivity: (p) => {
        activities.push(p.snippet);
      },
    });

    await buffer.appendText('Hello ');
    await buffer.appendText('world!');

    // Not yet flushed before 120ms
    expect(chunks).toHaveLength(0);

    vi.advanceTimersByTime(125);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({
      seq: 1,
      delta: 'Hello world!',
      entryId: 'entry_1',
      finalized: false,
    });

    // Adding a discrete TOOL_CALL entry closes the open TEXT entry (seq 1) and creates seq 2
    await buffer.entry('TOOL_CALL', 'vault_read', { tool: 'vault_read' });
    expect(createdEntries.map((e) => e.seq)).toEqual([1, 2]);
    expect(chunks).toHaveLength(3);
    expect(chunks[1]?.finalized).toBe(true);
    expect(chunks[2]?.seq).toBe(2);
    expect(activities.length).toBeGreaterThanOrEqual(1);
  });

  it('flushes immediately when pendingDelta reaches 512 chars', async () => {
    const chunks: string[] = [];
    const buffer = new LogBuffer('run_2', 'lead', {
      createEntry: async (data) => ({
        id: `entry_${data.seq}`,
        createdAt: new Date(),
      }),
      updateEntryContent: async () => {},
      emitLogChunk: (p) => {
        if (p.delta) chunks.push(p.delta);
      },
      emitActivity: () => {},
    });

    const bigText = 'x'.repeat(520);
    await buffer.appendText(bigText);
    expect(chunks).toEqual([bigText]);
    await buffer.flushAll();
  });
});
