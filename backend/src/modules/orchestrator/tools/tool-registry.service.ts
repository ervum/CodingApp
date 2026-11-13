import { Injectable, Optional } from '@nestjs/common';
import {
  AGENT_TOOL_DEFINITIONS,
  ToolArgs,
  type AgentTool,
  type ToolArgsOf,
} from '@robdev/shared';
import { AppError } from '../../../common/errors/app-error.js';
import type { LlmToolCall } from '../../llm/adapters/llm-adapter.interface.js';
import {
  AssetRegisterTool,
  AssetSearchTool,
} from './asset.tools.js';
import {
  BrowserActTool,
  BrowserExtractTool,
  BrowserNavigateTool,
  BrowserObserveTool,
  BrowserTabsTool,
} from './browser.tools.js';
import { CreatePitchTool } from './create-pitch.tool.js';
import { DelegateTaskTool } from './delegate-task.tool.js';
import { FlagBlockerTool } from './flag-blocker.tool.js';
import { GenerateImageTool } from './generate-image.tool.js';
import { MarketQueryTool } from './market-query.tool.js';
import { RecordBuildTool } from './record-build.tool.js';
import { RequestHumanTool } from './request-human.tool.js';
import {
  StudioInspectTreeTool,
  StudioReadScriptTool,
  StudioRunDiagnosticsTool,
  StudioRunPlaytestTool,
} from './roblox-studio-mcp.tools.js';
import {
  PcActTool,
  PcObserveTool,
  PcSandboxTool,
  PcWindowTool,
} from './pc-computer-use.tools.js';
import { StudioDirectTool } from './roblox-studio-direct.tools.js';
import { SaveArtifactTool } from './save-artifact.tool.js';
import {
  AcquireStudioLaneTool,
  ReleaseStudioLaneTool,
} from './studio-lane.tools.js';
import { SubmitForReviewTool } from './submit-for-review.tool.js';
import type { ToolContext, ToolHandler, ToolResult } from './tool-context.js';
import { UpdateMilestoneTool } from './update-milestone.tool.js';
import { VaultReadTool } from './vault-read.tool.js';
import { VaultSearchTool } from './vault-search.tool.js';
import { VaultUpdateDocumentTool } from './vault-update-document.tool.js';
import {
  CommentWorkspaceFileTool,
  EditWorkspaceFileTool,
  GrepWorkspaceTool,
  ListWorkspaceFilesTool,
  ReadWorkspaceFileTool,
  RunTerminalCommandTool,
} from './workspace-files.tools.js';

@Injectable()
export class ToolRegistryService {
  private readonly handlers = new Map<AgentTool, ToolHandler<AgentTool>>();

  constructor(
    vaultSearch: VaultSearchTool,
    vaultRead: VaultReadTool,
    vaultUpdate: VaultUpdateDocumentTool,
    delegateTask: DelegateTaskTool,
    requestHuman: RequestHumanTool,
    saveArtifact: SaveArtifactTool,
    marketQuery: MarketQueryTool,
    createPitch: CreatePitchTool,
    generateImage: GenerateImageTool,
    submitForReview: SubmitForReviewTool,
    flagBlocker: FlagBlockerTool,
    acquireLane: AcquireStudioLaneTool,
    releaseLane: ReleaseStudioLaneTool,
    recordBuild: RecordBuildTool,
    updateMilestone: UpdateMilestoneTool,
    @Optional() listWorkspaceFiles?: ListWorkspaceFilesTool,
    @Optional() readWorkspaceFile?: ReadWorkspaceFileTool,
    @Optional() grepWorkspace?: GrepWorkspaceTool,
    @Optional() editWorkspaceFile?: EditWorkspaceFileTool,
    @Optional() studioInspectTree?: StudioInspectTreeTool,
    @Optional() studioReadScript?: StudioReadScriptTool,
    @Optional() studioRunDiagnostics?: StudioRunDiagnosticsTool,
    @Optional() studioRunPlaytest?: StudioRunPlaytestTool,
    @Optional() commentWorkspaceFile?: CommentWorkspaceFileTool,
    @Optional() runTerminalCommand?: RunTerminalCommandTool,
    @Optional() pcObserve?: PcObserveTool,
    @Optional() pcAct?: PcActTool,
    @Optional() pcWindow?: PcWindowTool,
    @Optional() pcSandbox?: PcSandboxTool,
    @Optional() studioDirect?: StudioDirectTool,
    @Optional() browserNavigate?: BrowserNavigateTool,
    @Optional() browserObserve?: BrowserObserveTool,
    @Optional() browserAct?: BrowserActTool,
    @Optional() browserExtract?: BrowserExtractTool,
    @Optional() browserTabs?: BrowserTabsTool,
    @Optional() assetRegister?: AssetRegisterTool,
    @Optional() assetSearch?: AssetSearchTool,
  ) {
    this.register(vaultSearch);
    this.register(vaultRead);
    this.register(vaultUpdate);
    this.register(delegateTask);
    this.register(requestHuman);
    this.register(saveArtifact);
    this.register(marketQuery);
    this.register(createPitch);
    this.register(generateImage);
    this.register(submitForReview);
    this.register(flagBlocker);
    this.register(acquireLane);
    this.register(releaseLane);
    this.register(recordBuild);
    this.register(updateMilestone);
    if (listWorkspaceFiles) this.register(listWorkspaceFiles);
    if (readWorkspaceFile) this.register(readWorkspaceFile);
    if (grepWorkspace) this.register(grepWorkspace);
    if (editWorkspaceFile) this.register(editWorkspaceFile);
    if (studioInspectTree) this.register(studioInspectTree);
    if (studioReadScript) this.register(studioReadScript);
    if (studioRunDiagnostics) this.register(studioRunDiagnostics);
    if (studioRunPlaytest) this.register(studioRunPlaytest);
    if (commentWorkspaceFile) this.register(commentWorkspaceFile);
    if (runTerminalCommand) this.register(runTerminalCommand);
    if (pcObserve) this.register(pcObserve);
    if (pcAct) this.register(pcAct);
    if (pcWindow) this.register(pcWindow);
    if (pcSandbox) this.register(pcSandbox);
    if (studioDirect) this.register(studioDirect);
    if (browserNavigate) this.register(browserNavigate);
    if (browserObserve) this.register(browserObserve);
    if (browserAct) this.register(browserAct);
    if (browserExtract) this.register(browserExtract);
    if (browserTabs) this.register(browserTabs);
    if (assetRegister) this.register(assetRegister);
    if (assetSearch) this.register(assetSearch);
  }

  register<T extends AgentTool>(handler: ToolHandler<T>): void {
    this.handlers.set(
      handler.name,
      handler as unknown as ToolHandler<AgentTool>,
    );
  }

  async execute(call: LlmToolCall, ctx: ToolContext): Promise<ToolResult> {
    const startMs = Date.now();
    const isKnownTool = Object.prototype.hasOwnProperty.call(ToolArgs, call.name);
    const toolName = (isKnownTool ? call.name : 'vault_read') as AgentTool;

    let rawArgs: unknown = null;
    let jsonParseError: string | null = null;
    try {
      rawArgs = call.argumentsJson.trim() ? JSON.parse(call.argumentsJson) : {};
    } catch (err) {
      jsonParseError = err instanceof Error ? err.message : 'Invalid JSON arguments';
    }

    const label = isKnownTool
      ? AGENT_TOOL_DEFINITIONS[toolName].label
      : `Called ${call.name}`;

    await ctx.log.entry('TOOL_CALL', `${label} (${call.name})`, {
      tool: isKnownTool ? toolName : undefined,
      toolCallId: call.id,
      args: rawArgs ?? call.argumentsJson,
    });

    await ctx.prisma.agentRun.update({
      where: { id: ctx.run.id },
      data: { toolCallCount: { increment: 1 } },
    });

    let result: ToolResult;

    if (!isKnownTool || !ctx.agent.tools.includes(toolName)) {
      result = {
        payload: {
          ok: false,
          error: 'TOOL_NOT_GRANTED',
          message: `Tool "${call.name}" is not granted to agent ${ctx.agent.key}`,
        },
      };
    } else if (jsonParseError) {
      result = {
        payload: {
          ok: false,
          error: 'VALIDATION_FAILED',
          message: `Invalid JSON arguments: ${jsonParseError}`,
        },
      };
    } else {
      const schema = ToolArgs[toolName];
      const parsed = schema.safeParse(rawArgs);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        }));
        result = {
          payload: {
            ok: false,
            error: 'VALIDATION_FAILED',
            message: 'Tool argument validation failed',
            issues,
          },
        };
      } else {
        const handler = this.handlers.get(toolName);
        if (!handler) {
          result = {
            payload: {
              ok: false,
              error: 'INTERNAL',
              message: `No handler registered for tool "${toolName}"`,
            },
          };
        } else {
          try {
            result = await handler.execute(
              parsed.data as ToolArgsOf<AgentTool>,
              ctx,
            );
          } catch (err) {
            const code = err instanceof AppError ? err.code : 'INTERNAL';
            const message = err instanceof Error ? err.message : String(err);
            result = {
              payload: {
                ok: false,
                error: code,
                message,
              },
            };
          }
        }
      }
    }

    const durationMs = Math.max(1, Date.now() - startMs);
    const prettyContent = JSON.stringify(result.payload, null, 2).slice(0, 4000);
    const errorCode =
      !result.payload.ok && typeof result.payload.error === 'string'
        ? result.payload.error
        : undefined;

    await ctx.log.entry('TOOL_RESULT', prettyContent, {
      tool: isKnownTool ? toolName : undefined,
      toolCallId: call.id,
      ok: result.payload.ok,
      durationMs,
      errorCode,
    });

    return result;
  }
}
