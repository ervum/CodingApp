import { Injectable } from '@nestjs/common';
import type { ToolArgsOf } from '@robdev/shared';
import sharp from 'sharp';
import { LlmAdapterFactory } from '../../llm/llm-adapter.factory.js';
import { LlmConnectionsService } from '../../llm/llm-connections.service.js';
import { MediaService } from '../../media/media.service.js';
import type { ToolContext, ToolHandler, ToolResult } from './tool-context.js';

@Injectable()
export class GenerateImageTool implements ToolHandler<'generate_image'> {
  readonly name = 'generate_image' as const;

  constructor(
    private readonly llmConnections: LlmConnectionsService,
    private readonly adapterFactory: LlmAdapterFactory,
    private readonly media: MediaService,
  ) {}

  async execute(
    args: ToolArgsOf<'generate_image'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    if (!ctx.agent.imageConnectionId || !ctx.agent.imageModelId) {
      return {
        payload: {
          ok: false,
          error: 'NO_IMAGE_MODEL',
          message: 'Assign an image model to Splash in Settings → Models',
        },
      };
    }

    const connRow = await ctx.prisma.llmConnection.findFirst({
      where: {
        id: ctx.agent.imageConnectionId,
        studioId: ctx.studioId,
        isEnabled: true,
      },
    });

    if (!connRow) {
      return {
        payload: {
          ok: false,
          error: 'NO_IMAGE_MODEL',
          message: 'Assign an image model to Splash in Settings → Models',
        },
      };
    }

    const resolvedConn = this.llmConnections.decryptConnection(connRow);
    const width = args.kind === 'ICON' ? 512 : 1920;
    const height = args.kind === 'ICON' ? 512 : 1080;

    const imageAdapter = this.adapterFactory.forImageConnection(resolvedConn);
    const generated = await imageAdapter.generate(
      {
        model: ctx.agent.imageModelId,
        prompt: args.prompt,
        width,
        height,
      },
      ctx.signal,
    );

    const normalizedBuffer = await sharp(generated.data)
      .resize(width, height, { fit: 'cover' })
      .png()
      .toBuffer();

    const stored = await this.media.store(
      ctx.studioId,
      normalizedBuffer,
      'image/png',
    );

    await ctx.log.entry(
      'SYSTEM',
      `Generated ${args.kind} image (${stored.width ?? width}×${stored.height ?? height})`,
      {
        createdArtifact: {
          kind: 'image',
          id: stored.id,
          mediaId: stored.id,
          title: `${args.kind}: ${args.prompt.slice(0, 90)}`,
          bytes: stored.bytes,
        },
      },
    );

    return {
      payload: {
        ok: true,
        mediaId: stored.id,
        width: stored.width ?? width,
        height: stored.height ?? height,
        bytes: stored.bytes,
      },
    };
  }
}
