import { Injectable } from '@nestjs/common';
import type { AgentTool, ToolArgsOf } from '@robdev/shared';
import {
  BrowserAgentService,
  type BrowserObservationResult,
} from './browser-agent.service.js';
import type { ToolContext, ToolHandler, ToolResult } from './tool-context.js';

async function logBrowserObservation(
  ctx: ToolContext,
  toolName: AgentTool,
  obs: BrowserObservationResult,
): Promise<void> {
  await ctx.log.entry(
    'SYSTEM',
    `Browser observed "${obs.title || obs.url}" (${obs.width}×${obs.height}, ${obs.elements.length} interactive elements)`,
    {
      tool: toolName,
      ...(obs.mediaId
        ? {
            createdArtifact: {
              kind: 'image',
              id: obs.mediaId,
              mediaId: obs.mediaId,
              title: `Browser: ${obs.title || obs.url} (${obs.width}×${obs.height})`,
              path: obs.screenshotPath,
            },
          }
        : {}),
    },
  );
}

@Injectable()
export class BrowserNavigateTool implements ToolHandler<'browser_navigate'> {
  readonly name = 'browser_navigate' as const;

  constructor(private readonly browser: BrowserAgentService) {}

  async execute(
    args: ToolArgsOf<'browser_navigate'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const res = await this.browser.navigate({
      studioId: ctx.studioId,
      agentKey: ctx.agent.key,
      prisma: ctx.prisma,
      args,
    });

    if (res.observation) {
      await logBrowserObservation(ctx, this.name, res.observation);
    }

    return {
      payload: {
        ok: true,
        url: res.url,
        title: res.title,
        status: res.status,
        ...(res.observation
          ? {
              elementCount: res.observation.elements.length,
              elements: res.observation.elements,
              textExcerpt: res.observation.textExcerpt,
              consoleErrors: res.observation.consoleErrors,
              mediaId: res.observation.mediaId,
            }
          : {}),
      },
      ...(res.observation?.image ? { images: [res.observation.image] } : {}),
    };
  }
}

@Injectable()
export class BrowserObserveTool implements ToolHandler<'browser_observe'> {
  readonly name = 'browser_observe' as const;

  constructor(private readonly browser: BrowserAgentService) {}

  async execute(
    args: ToolArgsOf<'browser_observe'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const obs = await this.browser.observe({
      studioId: ctx.studioId,
      agentKey: ctx.agent.key,
      prisma: ctx.prisma,
      args,
    });

    await logBrowserObservation(ctx, this.name, obs);

    return {
      payload: {
        ok: true,
        url: obs.url,
        title: obs.title,
        width: obs.width,
        height: obs.height,
        elementCount: obs.elements.length,
        elements: obs.elements,
        textExcerpt: obs.textExcerpt,
        consoleErrors: obs.consoleErrors,
        ...(obs.mediaId ? { mediaId: obs.mediaId } : {}),
      },
      ...(obs.image ? { images: [obs.image] } : {}),
    };
  }
}

@Injectable()
export class BrowserActTool implements ToolHandler<'browser_act'> {
  readonly name = 'browser_act' as const;

  constructor(private readonly browser: BrowserAgentService) {}

  async execute(
    args: ToolArgsOf<'browser_act'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const res = await this.browser.act({
      studioId: ctx.studioId,
      agentKey: ctx.agent.key,
      prisma: ctx.prisma,
      args,
    });

    if (res.observation) {
      await logBrowserObservation(ctx, this.name, res.observation);
    }

    return {
      payload: {
        ok: res.ok,
        completedSteps: res.completedSteps,
        results: res.results,
        ...(res.failedStep ? { failedStep: res.failedStep } : {}),
        ...(res.observation
          ? {
              url: res.observation.url,
              title: res.observation.title,
              elementCount: res.observation.elements.length,
              elements: res.observation.elements,
              textExcerpt: res.observation.textExcerpt,
              consoleErrors: res.observation.consoleErrors,
              mediaId: res.observation.mediaId,
            }
          : {}),
      },
      ...(res.observation?.image ? { images: [res.observation.image] } : {}),
    };
  }
}

@Injectable()
export class BrowserExtractTool implements ToolHandler<'browser_extract'> {
  readonly name = 'browser_extract' as const;

  constructor(private readonly browser: BrowserAgentService) {}

  async execute(
    args: ToolArgsOf<'browser_extract'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const res = await this.browser.extract({
      studioId: ctx.studioId,
      agentKey: ctx.agent.key,
      args,
    });

    return {
      payload: {
        ok: true,
        url: res.url,
        title: res.title,
        mode: res.mode,
        content: res.content,
      },
    };
  }
}

@Injectable()
export class BrowserTabsTool implements ToolHandler<'browser_tabs'> {
  readonly name = 'browser_tabs' as const;

  constructor(private readonly browser: BrowserAgentService) {}

  async execute(
    args: ToolArgsOf<'browser_tabs'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const res = await this.browser.manageTabs({
      studioId: ctx.studioId,
      agentKey: ctx.agent.key,
      args,
    });

    return {
      payload: {
        ok: true,
        activeTabIndex: res.activeTabIndex,
        tabs: res.tabs,
      },
    };
  }
}
