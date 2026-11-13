import type { LlmModelInfoDto } from '@robdev/shared';
import type {
  BoundLlmAdapter,
  LlmAdapter,
  LlmStreamEvent,
  LlmStreamRequest,
  ResolvedConnection,
} from '../modules/llm/adapters/llm-adapter.interface.js';

export type ScriptedTurn = LlmStreamEvent[];

export class ScriptedLlmAdapter implements LlmAdapter {
  private turns: ScriptedTurn[] = [];
  readonly recordedRequests: LlmStreamRequest[] = [];

  setTurns(turns: ScriptedTurn[]): void {
    this.turns = [...turns];
    this.recordedRequests.length = 0;
  }

  async listModels(_conn: ResolvedConnection): Promise<LlmModelInfoDto[]> {
    return [
      {
        id: 'scripted-model-v1',
        displayName: 'Scripted Test Model v1',
        contextWindow: 128_000,
        supportsTools: true,
        supportsImageOutput: false,
      },
    ];
  }

  async *stream(
    _conn: ResolvedConnection,
    req: LlmStreamRequest,
    signal: AbortSignal,
  ): AsyncIterable<LlmStreamEvent> {
    this.recordedRequests.push(req);
    const turn = this.turns.shift() ?? [
      { type: 'text-delta', text: '## Result\n- Completed scripted turn.' },
      { type: 'usage', inputTokens: 100, outputTokens: 25 },
      { type: 'finish', reason: 'stop' },
    ];

    for (const ev of turn) {
      if (signal.aborted) {
        throw new Error('Aborted');
      }
      yield ev;
    }
  }

  asFactory(): {
    forConnection: (conn: ResolvedConnection) => BoundLlmAdapter;
    getAdapter: () => LlmAdapter;
  } {
    return {
      getAdapter: () => this,
      forConnection: (conn: ResolvedConnection): BoundLlmAdapter => ({
        listModels: () => this.listModels(conn),
        stream: (req, signal) => this.stream(conn, req, signal),
      }),
    };
  }
}
