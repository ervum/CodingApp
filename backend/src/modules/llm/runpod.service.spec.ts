import { describe, expect, it } from 'vitest';
import { RunpodService } from './runpod.service.js';

describe('RunpodService', () => {
  const svc = new RunpodService();

  it('builds RunPod Pod HTTP proxy OpenAI URLs for vLLM (8000) and Ollama (11434)', () => {
    expect(svc.buildPodProxyUrl('pod987xyz', 8000)).toBe(
      'https://pod987xyz-8000.proxy.runpod.net/v1',
    );
    expect(svc.buildPodProxyUrl('pod987xyz', 11434)).toBe(
      'https://pod987xyz-11434.proxy.runpod.net/v1',
    );
  });

  it('builds RunPod Serverless vLLM OpenAI-compatible URLs', () => {
    expect(svc.buildServerlessUrl('vllm-ep-123')).toBe(
      'https://api.runpod.ai/v2/vllm-ep-123/openai/v1',
    );
  });
});
