import type { ErrorCode } from '@robdev/shared';

export type RunAbortReason = 'PAUSED' | 'CANCELLED' | 'TIMEOUT';

export type RunOutcome =
  | { kind: 'succeeded'; summary?: string }
  | { kind: 'awaiting-human' }
  | { kind: 'interrupted' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; code: ErrorCode | string; message: string };
