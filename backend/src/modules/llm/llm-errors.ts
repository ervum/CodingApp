import { LlmError, type LlmStreamEvent } from './adapters/llm-adapter.interface.js';

export function normalizeProviderError(err: unknown): LlmError {
  if (err instanceof LlmError) {
    return err;
  }

  const record =
    typeof err === 'object' && err !== null ? (err as Record<string, unknown>) : {};
  const status =
    typeof record['status'] === 'number'
      ? record['status']
      : typeof record['statusCode'] === 'number'
        ? record['statusCode']
        : undefined;

  const message =
    typeof record['message'] === 'string' && record['message'].length > 0
      ? record['message']
      : String(err);

  let retryAfterMs: number | undefined;
  const headers = record['headers'] as Record<string, unknown> | Headers | undefined;
  if (headers) {
    const rawRetry =
      headers instanceof Headers
        ? headers.get('retry-after')
        : typeof headers['retry-after'] === 'string'
          ? headers['retry-after']
          : undefined;
    if (rawRetry) {
      const sec = Number(rawRetry);
      if (Number.isFinite(sec) && sec > 0) {
        retryAfterMs = Math.round(sec * 1000);
      }
    }
  }

  if (status === 401 || status === 403) {
    return new LlmError('PROVIDER_AUTH_FAILED', message, status);
  }
  if (status === 400 || status === 404 || status === 422) {
    return new LlmError('PROVIDER_BAD_REQUEST', message, status);
  }
  if (status === 429 || (status !== undefined && status >= 500)) {
    return new LlmError('PROVIDER_UNAVAILABLE', message, status, retryAfterMs);
  }

  return new LlmError('PROVIDER_UNAVAILABLE', message, status, retryAfterMs);
}

const BACKOFF_BASE_MS = [1000, 3000, 9000] as const;

export async function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    throw signal.reason ?? new Error('Aborted');
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('Aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function* streamWithPreStreamRetry(
  createStream: () => AsyncIterable<LlmStreamEvent>,
  signal: AbortSignal,
): AsyncIterable<LlmStreamEvent> {
  let attempt = 0;
  while (true) {
    let emittedAny = false;
    try {
      for await (const event of createStream()) {
        emittedAny = true;
        yield event;
      }
      return;
    } catch (err) {
      if (signal.aborted) {
        throw err;
      }
      const llmErr = normalizeProviderError(err);
      if (
        !emittedAny &&
        llmErr.code === 'PROVIDER_UNAVAILABLE' &&
        attempt < BACKOFF_BASE_MS.length
      ) {
        const base = BACKOFF_BASE_MS[attempt] ?? 9000;
        const jitterFactor = 0.8 + Math.random() * 0.4; // +/- 20%
        const waitMs = Math.max(llmErr.retryAfterMs ?? 0, Math.round(base * jitterFactor));
        attempt++;
        await sleepWithSignal(waitMs, signal);
        continue;
      }
      throw llmErr;
    }
  }
}
