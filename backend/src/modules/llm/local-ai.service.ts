import { Injectable } from '@nestjs/common';
import type { DetectedLocalServerDto, LlmProvider } from '@robdev/shared';
import { LlmError } from './adapters/llm-adapter.interface.js';

interface LocalProbeTarget {
  name: string;
  provider: LlmProvider;
  baseUrl: string;
  modelsUrl: string;
  kind: 'openai' | 'ollama';
}

const PROBE_TARGETS: readonly LocalProbeTarget[] = [
  {
    name: 'Ollama (localhost:11434)',
    provider: 'OLLAMA',
    baseUrl: 'http://localhost:11434/v1',
    modelsUrl: 'http://localhost:11434/api/tags',
    kind: 'ollama',
  },
  {
    name: 'LM Studio (localhost:1234)',
    provider: 'OLLAMA',
    baseUrl: 'http://localhost:1234/v1',
    modelsUrl: 'http://localhost:1234/v1/models',
    kind: 'openai',
  },
  {
    name: 'llama.cpp / LocalAI (localhost:8080)',
    provider: 'OLLAMA',
    baseUrl: 'http://localhost:8080/v1',
    modelsUrl: 'http://localhost:8080/v1/models',
    kind: 'openai',
  },
  {
    name: 'vLLM Local (localhost:8000)',
    provider: 'OLLAMA',
    baseUrl: 'http://localhost:8000/v1',
    modelsUrl: 'http://localhost:8000/v1/models',
    kind: 'openai',
  },
  {
    name: 'KoboldCpp (localhost:5001)',
    provider: 'OLLAMA',
    baseUrl: 'http://localhost:5001/v1',
    modelsUrl: 'http://localhost:5001/v1/models',
    kind: 'openai',
  },
];

@Injectable()
export class LocalAiService {
  async detectLocalServers(): Promise<DetectedLocalServerDto[]> {
    const probes = await Promise.all(
      PROBE_TARGETS.map((target) => this.probeOne(target)),
    );
    return probes.filter((p): p is DetectedLocalServerDto => p !== null);
  }

  async pullOllamaModel(
    baseUrl: string | null,
    modelName: string,
  ): Promise<{ ok: boolean; model: string; status: string }> {
    const rootUrl = (baseUrl ?? 'http://localhost:11434/v1')
      .replace(/\/v1\/?$/i, '')
      .replace(/\/+$/, '');

    const res = await fetch(`${rootUrl}/api/pull`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: modelName.trim(), stream: false }),
      signal: AbortSignal.timeout(300_000),
    }).catch((err: unknown) => {
      throw new LlmError(
        'PROVIDER_UNAVAILABLE',
        `Could not reach Ollama at ${rootUrl}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      throw new LlmError(
        'PROVIDER_BAD_REQUEST',
        `Ollama model pull failed (${res.status}): ${bodyText || res.statusText}`,
      );
    }

    const json = (await res.json().catch(() => ({}))) as { status?: string };
    return {
      ok: true,
      model: modelName.trim(),
      status: json.status ?? 'success',
    };
  }

  private async probeOne(
    target: LocalProbeTarget,
  ): Promise<DetectedLocalServerDto | null> {
    const start = Date.now();
    try {
      const res = await fetch(target.modelsUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(750),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as unknown;
      const latencyMs = Math.max(1, Date.now() - start);
      const models = this.extractModels(data, target.kind);
      return {
        name: target.name,
        provider: target.provider,
        baseUrl: target.baseUrl,
        models,
        latencyMs,
      };
    } catch {
      return null;
    }
  }

  private extractModels(data: unknown, kind: 'openai' | 'ollama'): string[] {
    if (typeof data !== 'object' || data === null) return [];
    if (kind === 'ollama' && 'models' in data && Array.isArray((data as { models: unknown }).models)) {
      return ((data as { models: Array<{ name?: unknown }> }).models)
        .map((m) => (typeof m.name === 'string' ? m.name : ''))
        .filter(Boolean);
    }
    if ('data' in data && Array.isArray((data as { data: unknown }).data)) {
      return ((data as { data: Array<{ id?: unknown }> }).data)
        .map((m) => (typeof m.id === 'string' ? m.id : ''))
        .filter(Boolean);
    }
    return [];
  }
}
