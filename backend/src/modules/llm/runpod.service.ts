import { Injectable } from '@nestjs/common';
import type { RunpodPodStatusDto } from '@robdev/shared';
import { LlmError, type ResolvedConnection } from './adapters/llm-adapter.interface.js';

@Injectable()
export class RunpodService {
  buildPodProxyUrl(podId: string, port = 8000): string {
    const cleanPodId = podId.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!cleanPodId) {
      throw new LlmError('PROVIDER_BAD_REQUEST', 'Invalid RunPod Pod ID');
    }
    return `https://${cleanPodId}-${port}.proxy.runpod.net/v1`;
  }

  buildServerlessUrl(endpointId: string): string {
    const cleanId = endpointId.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!cleanId) {
      throw new LlmError('PROVIDER_BAD_REQUEST', 'Invalid RunPod Serverless Endpoint ID');
    }
    return `https://api.runpod.ai/v2/${cleanId}/openai/v1`;
  }

  async controlPod(
    conn: ResolvedConnection,
    podId: string,
    action: 'RESUME' | 'STOP',
    port = 8000,
  ): Promise<RunpodPodStatusDto> {
    if (!conn.apiKey) {
      throw new LlmError(
        'PROVIDER_AUTH_FAILED',
        'A RunPod API key is required on the connection to start or stop a GPU Pod remotely.',
      );
    }

    const proxyBaseUrl = this.buildPodProxyUrl(podId, port);
    const query =
      action === 'RESUME'
        ? `mutation PodResume($podId: String!) { podResume(input: { podId: $podId, gpuCount: 1 }) { id desiredStatus } }`
        : `mutation PodStop($podId: String!) { podStop(input: { podId: $podId }) { id desiredStatus } }`;

    const res = await fetch('https://api.runpod.io/graphql', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${conn.apiKey}`,
      },
      body: JSON.stringify({
        query,
        variables: { podId: podId.trim() },
      }),
      signal: AbortSignal.timeout(15_000),
    }).catch((err: unknown) => {
      throw new LlmError(
        'PROVIDER_UNAVAILABLE',
        `RunPod GraphQL API unreachable: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    if (!res.ok) {
      throw new LlmError(
        res.status === 401 || res.status === 403
          ? 'PROVIDER_AUTH_FAILED'
          : 'PROVIDER_BAD_REQUEST',
        `RunPod API returned HTTP ${res.status}`,
      );
    }

    const payload = (await res.json()) as {
      data?: {
        podResume?: { id?: string; desiredStatus?: string };
        podStop?: { id?: string; desiredStatus?: string };
      };
      errors?: Array<{ message?: string }>;
    };

    if (payload.errors && payload.errors.length > 0) {
      throw new LlmError(
        'PROVIDER_BAD_REQUEST',
        payload.errors[0]?.message ?? 'RunPod GraphQL error',
      );
    }

    const rawStatus =
      payload.data?.podResume?.desiredStatus ??
      payload.data?.podStop?.desiredStatus ??
      (action === 'RESUME' ? 'RUNNING' : 'EXITED');

    const desiredStatus: 'RUNNING' | 'EXITED' | 'UNKNOWN' =
      rawStatus === 'RUNNING' || rawStatus === 'EXITED' ? rawStatus : 'UNKNOWN';

    return {
      podId: podId.trim(),
      desiredStatus,
      proxyBaseUrl,
      message:
        action === 'RESUME'
          ? `RunPod GPU pod ${podId.trim()} resuming at ${proxyBaseUrl}`
          : `RunPod GPU pod ${podId.trim()} stopped to save GPU credits`,
    };
  }
}
