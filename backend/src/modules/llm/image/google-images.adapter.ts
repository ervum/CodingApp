import { GoogleGenAI } from '@google/genai';
import { Injectable } from '@nestjs/common';
import { LlmError, type ResolvedConnection } from '../adapters/llm-adapter.interface.js';
import { normalizeProviderError } from '../llm-errors.js';
import {
  normalizeGeneratedImage,
  type ImageAdapter,
  type ImageGenerateRequest,
  type ImageGenerateResult,
} from './image-adapter.interface.js';

@Injectable()
export class GoogleImagesAdapter implements ImageAdapter {
  async generate(
    conn: ResolvedConnection,
    req: ImageGenerateRequest,
    signal: AbortSignal,
  ): Promise<ImageGenerateResult> {
    try {
      const ai = new GoogleGenAI({ apiKey: conn.apiKey ?? '' });
      const aspectRatio = req.width === req.height ? '1:1' : '16:9';
      const response = await ai.models.generateContent({
        model: req.model,
        contents: req.prompt,
        config: {
          responseModalities: ['IMAGE'],
          imageConfig: { aspectRatio },
          abortSignal: signal,
        },
      });

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const inline = parts.find((p) => p.inlineData?.data)?.inlineData;
      if (!inline?.data) {
        throw new LlmError('PROVIDER_BAD_REQUEST', 'Gemini image model returned no inlineData');
      }

      const rawBuffer = Buffer.from(inline.data, 'base64');
      return normalizeGeneratedImage(rawBuffer, req.width, req.height);
    } catch (err) {
      throw normalizeProviderError(err);
    }
  }
}
