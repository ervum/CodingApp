import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { LlmError, type ResolvedConnection } from '../adapters/llm-adapter.interface.js';
import { normalizeProviderError } from '../llm-errors.js';
import { DEFAULT_BASE_URL } from '../provider-defaults.js';
import {
  normalizeGeneratedImage,
  type ImageAdapter,
  type ImageGenerateRequest,
  type ImageGenerateResult,
} from './image-adapter.interface.js';

@Injectable()
export class OpenAiImagesAdapter implements ImageAdapter {
  async generate(
    conn: ResolvedConnection,
    req: ImageGenerateRequest,
    signal: AbortSignal,
  ): Promise<ImageGenerateResult> {
    try {
      const baseURL = conn.baseUrl ?? DEFAULT_BASE_URL[conn.provider] ?? undefined;
      const client = new OpenAI({
        apiKey: conn.apiKey ?? 'ollama',
        ...(baseURL ? { baseURL } : {}),
      });

      const size = req.width === req.height ? '1024x1024' : '1536x1024';
      const response = await client.images.generate(
        {
          model: req.model,
          prompt: req.prompt,
          size,
          n: 1,
        },
        { signal },
      );

      const first = response.data?.[0];
      if (!first) {
        throw new LlmError('PROVIDER_BAD_REQUEST', 'Image model returned no image data');
      }

      let rawBuffer: Buffer;
      if (first.b64_json) {
        rawBuffer = Buffer.from(first.b64_json, 'base64');
      } else if (first.url) {
        const res = await fetch(first.url, { signal });
        if (!res.ok) {
          throw new LlmError(
            'PROVIDER_UNAVAILABLE',
            `Failed to download generated image (HTTP ${res.status})`,
          );
        }
        const arr = await res.arrayBuffer();
        rawBuffer = Buffer.from(arr);
      } else {
        throw new LlmError(
          'PROVIDER_BAD_REQUEST',
          'Image model returned neither b64_json nor url',
        );
      }

      return normalizeGeneratedImage(rawBuffer, req.width, req.height);
    } catch (err) {
      throw normalizeProviderError(err);
    }
  }
}
