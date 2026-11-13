import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Injectable } from '@nestjs/common';
import {
  AGENT_ROSTER,
  AGENT_TOOL_DEFINITIONS,
  GENERAL_AGENT_TITLES,
  type AgentKey,
  type AgentTool,
  type ChatAttachment,
  type ChatDirective,
  type CodingMode,
  type CodingSyncTool,
  type ContextMode,
  type InjectedDocRef,
  type RunLogMeta,
  type TaskPriority,
} from '@robdev/shared';
import { z } from 'zod';
import { AppConfigService } from '../../config/app-config.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type {
  LlmImageAttachment,
  LlmMessage,
  LlmToolCall,
  LlmToolDef,
} from '../llm/adapters/llm-adapter.interface.js';
import {
  AGENT_PERSONAS,
  GENERAL_AGENT_PERSONAS,
} from '../studios/provision-studio.js';
import {
  buildCodingModeContract,
  buildPermissionsContract,
} from './coding-mode-rules.js';
import {
  buildCompactWorkspaceTree,
  getStudioCodingConfig,
  readWorkspaceFileContent,
} from './tools/workspace-files.tools.js';
import { VaultContextService } from './vault-context.service.js';

export const STUDIO_PREAMBLE = (
  studio: string,
  agent: string,
  date: string,
): string =>
  `You are ${agent}, a specialist AI agent at the Roblox game studio "${studio}". Today is ${date}.
You work inside RobDev Control Room alongside 14 other agents coordinated by Lead.
Studio rules live in the Knowledge Vault. The vault documents below are authoritative: when they conflict with your general knowledge, the vault wins. Cite a vault rule by its document title in brackets, e.g. [05 UI and HUD].`;

export const GENERAL_STUDIO_PREAMBLE = (
  studio: string,
  agent: string,
  date: string,
): string =>
  `You are ${agent}, a specialist AI software engineering agent at "${studio}". Today is ${date}.
You work inside the Control Room alongside 14 other specialist agents coordinated by Lead.
The studio is operating in **General Mode** (Roblox mode is deactivated): build any software, scripts, web apps, APIs, CLI tools, data pipelines, or documents requested by the user inside \`/workspace/\`.`;

export const OUTPUT_CONTRACT = `AGENTIC ENGINEERING & OUTPUT CONTRACT
- **Read Before Write (Interleaved Tool Loop)**: Before modifying existing systems or creating coupled scripts, inspect the workspace using \`read_workspace_file\`, \`grep_workspace\`, \`list_workspace_files\`, or \`studio_inspect_tree\` / \`studio_read_script\`. You can call tools across multiple turns mid-workflow and receive their results in \`[TOOL_RESULT]\`.
- **Surgical Edits vs. New Files**: Use \`edit_workspace_file\` (\`target\` -> \`replacement\`) to make surgical changes to existing files without rewriting unchanged lines. Use \`save_artifact\` when creating a brand-new file. Always pass a helpful \`comment\` explaining the file or revision.
- **Strict Production Luau Standards**:
  1. Begin Luau scripts with \`--!strict\` and define explicit types (\`export type ...\`).
  2. Always retrieve services with \`game:GetService("...")\` and use \`task.wait\`, \`task.spawn\`, \`task.defer\`, and \`task.delay\` (never use deprecated \`wait()\`, \`spawn()\`, \`delay()\`, or \`game.Workspace\`).
  3. Enforce strict server authority on all \`RemoteEvent\` / \`RemoteFunction\` handlers (validate payload types with \`typeof\`, guard against \`NaN\`/inf, enforce cooldowns and distance/state checks) and disconnect event connections when instances are destroyed.
  4. Never leave placeholders, stub functions, or \`TODO\` / \`FIXME\` comments—every file must be 100% complete and production-ready.
- **Closed-Loop Self-Verification**: Both \`save_artifact\` and \`edit_workspace_file\` automatically run static Luau diagnostics (\`luauDiagnostics\`). If \`luauDiagnostics.issues\` reports any syntax, block-balance, or return errors, fix them immediately in a follow-up tool call before finishing.
- **Formatting & Summary**: Write in GitHub-flavoured Markdown. If you need a decision only a human can make, call \`request_human\` and stop. Finish with a "## Result" section of at most 5 bullet points summarising what you built and verified.`;

export const GENERAL_OUTPUT_CONTRACT = `AGENTIC ENGINEERING & OUTPUT CONTRACT (GENERAL MODE)
- **Read Before Write (Interleaved Tool Loop)**: Before modifying existing systems or creating coupled files, inspect \`/workspace/\` using \`list_workspace_files\`, \`read_workspace_file\`, or \`grep_workspace\`. You can call tools across multiple turns mid-workflow and receive their results in \`[TOOL_RESULT]\`.
- **Surgical Edits vs. New Files**: Use \`edit_workspace_file\` (\`target\` -> \`replacement\`) to make surgical changes to existing files without rewriting unchanged lines. Use \`save_artifact\` when creating a brand-new file. Always include a concise \`comment\` on \`save_artifact\` or \`edit_workspace_file\` (or call \`comment_workspace_file\`) so your notes appear in the Workspace Explorer.
- **Production Code Quality**:
  1. Write clean, modular, strongly typed, and well-structured code in the language appropriate for the task.
  2. Validate inputs, handle errors gracefully, and never leave stub functions or \`TODO\` / \`FIXME\` placeholders—every file must be 100% complete and ready to run.
  3. You can run shell commands on Command Prompt (\`cmd\`), PowerShell (\`powershell\`, \`pwsh\`), or \`bash\` via \`run_terminal_command\` (which automatically asks for human permission first unless auto-allowed in Settings).
- **Formatting & Summary**: Write in GitHub-flavoured Markdown. If you need a decision only a human can make, call \`request_human\` and stop. Finish with a "## Result" section of at most 5 bullet points summarising what you built and verified.`;

export interface PromptResolutionInput {
  studioId: string;
  studioName: string;
  runId: string;
  agent: {
    id: string;
    key: AgentKey;
    displayName: string;
    systemPrompt: string;
    tools: AgentTool[];
  };
  task: {
    id: string;
    title: string;
    brief: string;
    priority: TaskPriority;
    tags: string[];
    parentTaskId: string | null;
    gameId: string | null;
  };
  game: {
    id: string;
    name: string;
    genre: string;
    status: string;
    latestSavedVersion: number | null;
    latestPublishedVersion: number | null;
  } | null;
}

export interface ResolvedPrompt {
  messages: LlmMessage[];
  toolDefs: LlmToolDef[];
  injected: InjectedDocRef[];
}

@Injectable()
export class PromptResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: AppConfigService,
    private readonly vaultContext: VaultContextService,
  ) {}

  async resolve(ctx: PromptResolutionInput): Promise<ResolvedPrompt> {
    const today = new Date().toISOString().slice(0, 10);

    const studioRow = await this.prisma.studio
      ?.findUnique?.({
        where: { id: ctx.studioId },
        select: {
          codingMode: true,
          codingSyncTool: true,
          contextMode: true,
          allowTerminalWithoutPermission: true,
          allowExternalFilesWithoutPermission: true,
          allowPcControlWithoutPermission: true,
          pcIdleTakeoverSeconds: true,
          sandboxAccessPolicy: true,
          sandboxProviderKind: true,
          maxConcurrentSandboxes: true,
          allowAutoSaveVersion: true,
          allowAutoPublish: true,
        },
      })
      .catch(() => null);

    const codingMode = (studioRow?.codingMode as CodingMode) ?? 'LOCAL_SYNC';
    const codingSyncTool =
      (studioRow?.codingSyncTool as CodingSyncTool) ?? 'SILICON';
    const contextMode: ContextMode =
      studioRow?.contextMode === 'GENERAL' ? 'GENERAL' : 'ROBLOX';
    const allowTerminalWithoutPermission =
      studioRow?.allowTerminalWithoutPermission ?? false;
    const allowExternalFilesWithoutPermission =
      studioRow?.allowExternalFilesWithoutPermission ?? false;

    const { vaultBlock, injected } = await this.vaultContext.selectDocuments({
      studioId: ctx.studioId,
      runId: ctx.runId,
      agentId: ctx.agent.id,
      taskBrief: ctx.task.brief,
      taskTags: ctx.task.tags,
      budgetTokens: this.cfg.vaultTokenBudget,
      contextMode,
    });

    const isGeneral = contextMode === 'GENERAL';
    const effectivePersona = isGeneral
      ? (GENERAL_AGENT_PERSONAS[ctx.agent.key] ?? ctx.agent.systemPrompt)
      : (AGENT_PERSONAS[ctx.agent.key] ?? ctx.agent.systemPrompt);

    const systemContent = [
      isGeneral
        ? GENERAL_STUDIO_PREAMBLE(ctx.studioName, ctx.agent.displayName, today)
        : STUDIO_PREAMBLE(ctx.studioName, ctx.agent.displayName, today),
      effectivePersona,
      vaultBlock,
      buildCodingModeContract(codingMode, codingSyncTool, contextMode),
      buildPermissionsContract(
        allowTerminalWithoutPermission,
        allowExternalFilesWithoutPermission,
        {
          allowPcControlWithoutPermission:
            studioRow?.allowPcControlWithoutPermission ?? false,
          pcIdleTakeoverSeconds: studioRow?.pcIdleTakeoverSeconds ?? 60,
          sandboxAccessPolicy:
            (studioRow?.sandboxAccessPolicy as 'ALLOW' | 'ASK' | 'DENY') ??
            'ALLOW',
          sandboxProviderKind:
            (studioRow?.sandboxProviderKind as 'LOCAL' | 'CLOUD_GPU') ?? 'LOCAL',
          maxConcurrentSandboxes: studioRow?.maxConcurrentSandboxes ?? 15,
          allowAutoSaveVersion: studioRow?.allowAutoSaveVersion ?? true,
          allowAutoPublish: studioRow?.allowAutoPublish ?? true,
        },
      ),
      isGeneral ? GENERAL_OUTPUT_CONTRACT : OUTPUT_CONTRACT,
    ].join('\n\n');

    const lineageTitles = await this.loadTaskLineage(
      ctx.studioId,
      ctx.task.parentTaskId,
    );
    const depResults = await this.loadDependencyResults(ctx.task.id);

    const contextLines: string[] = [
      '[CONTEXT]',
      `Studio: ${ctx.studioName}`,
      `Mode: ${isGeneral ? 'General Software Engineering (Roblox mode OFF)' : 'Roblox Studio'}`,
      `Date: ${today}`,
    ];

    if (ctx.game && !isGeneral) {
      contextLines.push(
        `Game: ${ctx.game.name} (genre: ${ctx.game.genre}, status: ${ctx.game.status}, saved: ${ctx.game.latestSavedVersion ? `v${ctx.game.latestSavedVersion}` : 'none'}, published: ${ctx.game.latestPublishedVersion ? `v${ctx.game.latestPublishedVersion}` : 'none'})`,
      );
    } else if (ctx.game && isGeneral) {
      contextLines.push(`Project: ${ctx.game.name}`);
    }

    if (lineageTitles.length > 0) {
      contextLines.push(`Task lineage: ${lineageTitles.join(' → ')}`);
    }

    if (depResults.length > 0) {
      contextLines.push('Dependency results:');
      for (const dep of depResults) {
        const filesNote =
          dep.artifacts.length > 0
            ? ` (files created: ${dep.artifacts.join(', ')})`
            : '';
        contextLines.push(`- [${dep.title}]${filesNote}: ${dep.summary}`);
      }
    }

    const subtaskResults = await this.loadSpecialistSubtaskResults(
      ctx.studioId,
      ctx.task.id,
      ctx.task.parentTaskId,
    );
    if (subtaskResults.length > 0) {
      contextLines.push('Completed specialist subtasks in this workflow:');
      for (const sub of subtaskResults) {
        const filesNote =
          sub.artifacts.length > 0
            ? ` [files: ${sub.artifacts.join(', ')}]`
            : '';
        contextLines.push(
          `- ${sub.agentKey} · [${sub.title}] (${sub.status})${filesNote}: ${sub.summary}`,
        );
      }
    }

    if (ctx.agent.key === 'lead' || ctx.agent.key === 'producer') {
      contextLines.push('Specialist Agent Roster:');
      for (const spec of AGENT_ROSTER) {
        const roleTitle = isGeneral
          ? (GENERAL_AGENT_TITLES[spec.key] ?? spec.generalTitle ?? spec.title)
          : spec.title;
        contextLines.push(`- ${spec.key} (${spec.name}): ${roleTitle}`);
      }
    }

    const workspaceTree = await buildCompactWorkspaceTree({
      studioId: ctx.studioId,
      prisma: this.prisma,
    }).catch(() => null);
    if (workspaceTree) {
      contextLines.push('', workspaceTree);
    }

    const recentMessages = await (
      this.prisma.agentMessage?.findMany?.({
        where: {
          studioId: ctx.studioId,
          agentId: ctx.agent.id,
          taskId: ctx.task.id,
          archiveId: null,
          author: { in: ['USER', 'AGENT'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }) ?? Promise.resolve([])
    ).catch(() => []);
    const msgsAsc = [...recentMessages].reverse();

    // Load prior non-archived runs on this task so multi-turn conversations include AI replies
    const priorRuns = await (
      this.prisma.agentRun?.findMany?.({
        where: {
          studioId: ctx.studioId,
          agentId: ctx.agent.id,
          taskId: ctx.task.id,
          archiveId: null,
          id: { not: ctx.runId },
        },
        orderBy: { startedAt: 'asc' },
        take: 20,
        include: {
          entries: {
            where: { kind: 'TEXT' },
            orderBy: { seq: 'asc' },
          },
        },
      }) ?? Promise.resolve([])
    ).catch(() => []);

    // Identify the latest USER message for this turn (which matches ctx.task.brief)
    const latestUserMsg = [...msgsAsc].reverse().find((m) => m.author === 'USER');
    const historyItems: Array<{
      role: 'user' | 'assistant';
      content: string;
      timeMs: number;
    }> = [];

    for (const m of msgsAsc) {
      if (latestUserMsg && m.id === latestUserMsg.id && msgsAsc.length === 1 && priorRuns.length === 0) {
        // First turn user message is already placed in [TASK]
        continue;
      }
      if (latestUserMsg && m.id === latestUserMsg.id) {
        // Current turn user message will be placed in [TASK]
        continue;
      }
      historyItems.push({
        role: m.author === 'USER' ? 'user' : 'assistant',
        content: m.body,
        timeMs: m.createdAt.getTime(),
      });
    }

    for (const r of priorRuns) {
      const textEntries = (r.entries ?? []).filter((e) => e.content.trim().length > 0);
      const lastText =
        textEntries[textEntries.length - 1]?.content.trim() ??
        (r.summary ?? '').trim();
      if (lastText) {
        const entryTime =
          textEntries[textEntries.length - 1]?.createdAt?.getTime() ??
          r.finishedAt?.getTime() ??
          r.startedAt.getTime();
        historyItems.push({
          role: 'assistant',
          content: lastText,
          timeMs: entryTime,
        });
      }
    }

    historyItems.sort((a, b) => a.timeMs - b.timeMs);

    const hasHumanReplyAfterAgent =
      (msgsAsc.some((m) => m.author === 'AGENT') || priorRuns.length > 0) &&
      msgsAsc[msgsAsc.length - 1]?.author === 'USER';

    const latestAttachments: ChatAttachment[] = Array.isArray(
      (latestUserMsg as unknown as { attachments?: unknown } | undefined)?.attachments,
    )
      ? ((latestUserMsg as unknown as { attachments: ChatAttachment[] }).attachments ?? [])
      : [];
    const latestDirectives: ChatDirective[] = Array.isArray(
      (latestUserMsg as unknown as { directives?: unknown } | undefined)?.directives,
    )
      ? ((latestUserMsg as unknown as { directives: ChatDirective[] }).directives ?? [])
      : [];

    const { attachedBlocks, attachedImages } = await this.resolveChatAttachments(
      ctx.studioId,
      latestAttachments,
    );
    const directiveLines = this.resolveChatDirectives(latestDirectives);

    const taskLines: string[] = hasHumanReplyAfterAgent
      ? [
          '[TASK]',
          `Priority: ${ctx.task.priority}`,
          `Tags: ${ctx.task.tags.length > 0 ? ctx.task.tags.join(', ') : 'none'}`,
          ...(directiveLines.length > 0 ? ['', ...directiveLines] : []),
          ...(attachedBlocks.length > 0
            ? ['', '[ATTACHED CONTEXT]', ...attachedBlocks]
            : []),
          '',
          ctx.task.brief,
          '',
          'The human replied — continue from where you stopped.',
        ]
      : [
          '[TASK]',
          `Title: ${ctx.task.title}`,
          `Priority: ${ctx.task.priority}`,
          `Tags: ${ctx.task.tags.length > 0 ? ctx.task.tags.join(', ') : 'none'}`,
          ...(directiveLines.length > 0 ? ['', ...directiveLines] : []),
          ...(attachedBlocks.length > 0
            ? ['', '[ATTACHED CONTEXT]', ...attachedBlocks]
            : []),
          '',
          ctx.task.brief,
        ];

    const recoveredToolMessages = await this.recoverUnansweredToolTurn(
      ctx.studioId,
      ctx.task.id,
      ctx.runId,
    ).catch(() => [] as LlmMessage[]);

    const messages: LlmMessage[] = [
      { role: 'system', content: systemContent },
      { role: 'user', content: contextLines.join('\n') },
      ...historyItems.map(
        (m): LlmMessage => ({
          role: m.role,
          content: m.content,
        }),
      ),
      ...recoveredToolMessages,
      {
        role: 'user',
        content: taskLines.join('\n'),
        ...(attachedImages.length > 0 ? { images: attachedImages } : {}),
      },
    ];

    const toolDefs: LlmToolDef[] = ctx.agent.tools.map((toolName) => {
      const def = AGENT_TOOL_DEFINITIONS[toolName];
      const schema = z.toJSONSchema(def.args) as Record<string, unknown>;
      return {
        name: def.name,
        description: def.description,
        parameters: schema,
      };
    });

    return {
      messages,
      toolDefs,
      injected,
    };
  }

  private resolveChatDirectives(directives: readonly ChatDirective[]): string[] {
    const lines: string[] = [];
    if (directives.includes('PC_CONTROL')) {
      lines.push(
        '[DIRECTIVE: /pc-control] The human operator explicitly authorized Direct Main PC Control (targetEnv: "MAIN_PC") for this task. You may call pc_observe, pc_act, and pc_window on MAIN_PC immediately without pausing for permission.',
      );
    }
    if (directives.includes('PC_CONTROL_SANDBOX')) {
      lines.push(
        '[DIRECTIVE: /pc-control-with-sandbox] Perform all PC/desktop/browser automation inside your isolated Agent Sandbox (targetEnv: "SANDBOX") using pc_sandbox, pc_observe, pc_act, and pc_window. Do NOT target MAIN_PC.',
      );
    }
    if (directives.includes('BROWSER')) {
      lines.push(
        '[DIRECTIVE: /browser] Use your autonomous Playwright browser tools (browser_navigate, browser_observe, browser_act, browser_extract, browser_tabs) to research, navigate, interact with web pages, and verify web UI for this task.',
      );
    }
    if (directives.includes('PLAN_FIRST')) {
      lines.push(
        '[DIRECTIVE: /plan] First produce a structured, step-by-step implementation plan (Goal, Files/Systems Affected, Step-by-Step Plan, Verification Plan) before executing destructive or large-scale changes.',
      );
    }
    return lines;
  }

  private async resolveChatAttachments(
    studioId: string,
    attachments: readonly ChatAttachment[],
  ): Promise<{ attachedBlocks: string[]; attachedImages: LlmImageAttachment[] }> {
    const attachedBlocks: string[] = [];
    const attachedImages: LlmImageAttachment[] = [];
    if (attachments.length === 0) {
      return { attachedBlocks, attachedImages };
    }

    const codingCfg = await getStudioCodingConfig({
      studioId,
      prisma: this.prisma,
    }).catch(() => null);
    const workspaceRoot = codingCfg?.workspaceRoot ?? path.resolve(process.cwd(), 'workspace');

    for (const att of attachments) {
      try {
        switch (att.kind) {
          case 'vault_doc': {
            const doc = await this.prisma.vaultDocument?.findFirst?.({
              where: { id: att.documentId, studioId },
            });
            if (doc) {
              attachedBlocks.push(
                `### Vault Context Rule: ${doc.title} (${doc.path})\n${doc.markdown.slice(0, 16000)}`,
              );
            }
            break;
          }
          case 'workspace_file': {
            const rel = att.relPath ?? att.path;
            const fileRes = await readWorkspaceFileContent(
              { studioId, prisma: this.prisma },
              rel,
            ).catch(() => null);
            if (fileRes) {
              attachedBlocks.push(
                `### Workspace File: ${rel}\n\`\`\`\n${fileRes.content.slice(0, 16000)}\n\`\`\``,
              );
            }
            break;
          }
          case 'workspace_folder': {
            const rel = att.relPath ?? att.path;
            const folderAbs = path.resolve(workspaceRoot, rel);
            const entries = await fs.readdir(folderAbs, { withFileTypes: true }).catch(() => []);
            const listing = entries
              .slice(0, 60)
              .map((e) => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${rel}/${e.name}`)
              .join('\n');
            attachedBlocks.push(
              `### Workspace Folder: ${rel}\nContents:\n${listing || '(empty folder)'}`,
            );
            break;
          }
          case 'game': {
            const game = await this.prisma.game?.findFirst?.({
              where: { id: att.gameId, studioId },
            });
            if (game) {
              attachedBlocks.push(
                `### Game Context: ${game.name}\nGenre: ${game.genre} | Status: ${game.status} | Saved: ${game.latestSavedVersion ?? 'none'} | Published: ${game.latestPublishedVersion ?? 'none'}\nSummary: ${game.description || 'N/A'}`,
              );
            }
            break;
          }
          case 'task': {
            const t = await this.prisma.task?.findFirst?.({
              where: { id: att.taskId, studioId },
            });
            if (t) {
              attachedBlocks.push(
                `### Referenced Task: ${t.title} (${t.status})\nBrief: ${t.brief}\nResult: ${t.resultSummary ?? 'N/A'}`,
              );
            }
            break;
          }
          case 'chat_artifact': {
            const art = await this.prisma.runArtifact?.findFirst?.({
              where: att.artifactId
                ? { id: att.artifactId }
                : { path: att.path, ...(att.runId ? { runId: att.runId } : {}) },
            });
            if (art) {
              attachedBlocks.push(
                `### Chat Artifact: ${att.path}\n\`\`\`${art.language || ''}\n${art.content.slice(0, 16000)}\n\`\`\``,
              );
            }
            break;
          }
          case 'upload_file': {
            const rel = att.relPath ?? att.relativePath ?? att.name;
            const uploadPath = path.resolve(
              workspaceRoot,
              '.chat-uploads',
              att.uploadId,
              rel,
            );
            if (att.mimeType.startsWith('image/')) {
              const buf = await fs.readFile(uploadPath).catch(() => null);
              if (buf) {
                attachedImages.push({
                  mimeType: att.mimeType,
                  base64: buf.toString('base64'),
                  filePath: uploadPath,
                });
                attachedBlocks.push(
                  `### Uploaded Image: ${att.name} (.chat-uploads/${att.uploadId}/${rel})`,
                );
              }
            } else {
              const text = await fs.readFile(uploadPath, 'utf8').catch(() => null);
              if (text !== null) {
                attachedBlocks.push(
                  `### Uploaded File: ${att.name} (.chat-uploads/${att.uploadId}/${rel})\n\`\`\`\n${text.slice(0, 16000)}\n\`\`\``,
                );
              }
            }
            break;
          }
          case 'upload_folder': {
            const folderDisplay = att.name ?? att.rootName;
            const uploadDir = path.resolve(workspaceRoot, '.chat-uploads', att.uploadId);
            const entries = await fs.readdir(uploadDir, { withFileTypes: true }).catch(() => []);
            const listing = entries
              .slice(0, 60)
              .map((e) => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`)
              .join('\n');
            attachedBlocks.push(
              `### Uploaded Folder Copy: ${folderDisplay} (.chat-uploads/${att.uploadId}, ${att.fileCount} files)\nTop-level entries:\n${listing}\nUse \`list_workspace_files\` or \`read_workspace_file\` on \`.chat-uploads/${att.uploadId}/...\` to inspect any file.`,
            );
            break;
          }
          case 'local_folder': {
            const entries = await fs.readdir(att.absPath, { withFileTypes: true }).catch(() => []);
            const listing = entries
              .slice(0, 60)
              .map((e) => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`)
              .join('\n');
            attachedBlocks.push(
              `### Linked Local Folder (Read-Only Access Granted for This Task): ${att.absPath}\nTop-level entries:\n${listing || '(empty)'}\nYou have read-only access to \`${att.absPath}\` via \`list_workspace_files\`, \`read_workspace_file\`, and \`grep_workspace\` without pausing for permission.`,
            );
            break;
          }
          case 'image': {
            const media = await this.prisma.mediaFile?.findFirst?.({
              where: { id: att.mediaId, studioId },
            });
            if (media) {
              const mediaAbs = path.resolve(this.cfg.mediaStorageRoot, media.storageKey);
              const buf = await fs.readFile(mediaAbs).catch(() => null);
              if (buf) {
                attachedImages.push({
                  mediaId: media.id,
                  mimeType: media.mimeType,
                  base64: buf.toString('base64'),
                  filePath: mediaAbs,
                  ...(media.width ? { width: media.width } : {}),
                  ...(media.height ? { height: media.height } : {}),
                });
                attachedBlocks.push(`### Attached Screenshot / Image: ${att.name} (${media.mimeType})`);
              }
            }
            break;
          }
        }
      } catch {
        // Ignore individual attachment resolution errors
      }
    }

    return { attachedBlocks, attachedImages };
  }

  /**
   * If the immediately preceding run on this task ended after executing tool calls (`TOOL_CALL` + `TOOL_RESULT`)
   * without producing a subsequent assistant `TEXT` response (for example, if the web composer stalled before sending
   * `[TOOL_RESULT]`), reconstructs those tool calls and full tool results so typing "Continue" seamlessly resumes the loop.
   */
  private async recoverUnansweredToolTurn(
    studioId: string,
    taskId: string,
    _currentRunId: string,
  ): Promise<LlmMessage[]> {
    const prevRun = await this.prisma.agentRun?.findFirst?.({
      where: {
        studioId,
        taskId,
        archiveId: null,
      },
      orderBy: { startedAt: 'desc' },
      include: {
        entries: { orderBy: { seq: 'asc' } },
      },
    });

    if (!prevRun || !prevRun.entries || prevRun.entries.length === 0) {
      return [];
    }

    let lastAssistantTextIdx = -1;
    let lastAssistantText = '';
    for (let i = 0; i < prevRun.entries.length; i++) {
      const e = prevRun.entries[i]!;
      const meta = (e.meta as RunLogMeta | null) ?? null;
      if (e.kind === 'TEXT' && !meta?.isThinking && e.content.trim()) {
        lastAssistantTextIdx = i;
        lastAssistantText = e.content.trim();
      }
    }

    const trailingEntries = prevRun.entries.slice(lastAssistantTextIdx + 1);
    const hasTrailingToolResults = trailingEntries.some(
      (e) => e.kind === 'TOOL_RESULT',
    );
    if (!hasTrailingToolResults) {
      return [];
    }

    const toolCalls: LlmToolCall[] = [];
    const callArgsById = new Map<
      string,
      { toolName: string; args: Record<string, unknown> }
    >();

    for (const e of trailingEntries) {
      if (e.kind === 'TOOL_CALL') {
        const meta = (e.meta as RunLogMeta | null) ?? null;
        const toolName = meta?.tool ?? 'read_workspace_file';
        const callId = meta?.toolCallId ?? `recovered_call_${e.seq}`;
        const rawArgs =
          typeof meta?.args === 'object' && meta.args !== null
            ? (meta.args as Record<string, unknown>)
            : {};
        toolCalls.push({
          id: callId,
          name: toolName,
          argumentsJson: JSON.stringify(rawArgs),
        });
        callArgsById.set(callId, { toolName, args: rawArgs });
      }
    }

    const toolResultMessages: LlmMessage[] = [];
    for (const e of trailingEntries) {
      if (e.kind !== 'TOOL_RESULT') continue;
      const meta = (e.meta as RunLogMeta | null) ?? null;
      const callId = meta?.toolCallId ?? `recovered_call_${e.seq}`;
      const callInfo = callArgsById.get(callId);
      const toolName = meta?.tool ?? callInfo?.toolName ?? 'read_workspace_file';
      let content = e.content;

      // Re-hydrate full file reads from disk if the log entry was truncated at 4000 chars
      if (
        (toolName === 'read_workspace_file' || toolName === 'studio_read_script') &&
        typeof callInfo?.args['path'] === 'string'
      ) {
        const fileRes = await readWorkspaceFileContent(
          { studioId, prisma: this.prisma },
          callInfo.args['path'],
        ).catch(() => null);
        if (fileRes) {
          const allLines = fileRes.content.split(/\r?\n/);
          const totalLines = allLines.length;
          const startLine = Math.max(
            1,
            typeof callInfo.args['startLine'] === 'number'
              ? callInfo.args['startLine']
              : 1,
          );
          const requestedEnd =
            typeof callInfo.args['endLine'] === 'number'
              ? callInfo.args['endLine']
              : startLine + 649;
          const endLine = Math.min(
            totalLines,
            Math.min(requestedEnd, startLine + 749),
          );
          const numbered = allLines
            .slice(startLine - 1, endLine)
            .map((line, idx) => `${startLine + idx}: ${line}`)
            .join('\n');
          content = JSON.stringify({
            ok: true,
            path: fileRes.resolvedPath,
            sourceRoot: fileRes.sourceRoot,
            totalLines,
            startLine,
            endLine,
            contentWithLineNumbers: numbered,
          });
        }
      }

      toolResultMessages.push({
        role: 'tool',
        toolCallId: callId,
        name: toolName,
        content,
      });
    }

    if (toolResultMessages.length === 0) {
      return [];
    }

    return [
      {
        role: 'assistant',
        content: lastAssistantText,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      },
      ...toolResultMessages,
    ];
  }

  private async loadTaskLineage(
    studioId: string,
    parentTaskId: string | null,
  ): Promise<string[]> {
    const titles: string[] = [];
    let cursor = parentTaskId;
    let depth = 0;

    while (cursor && depth < 3) {
      depth += 1;
      const parent = await this.prisma.task.findFirst({
        where: { id: cursor, studioId },
        select: { title: true, parentTaskId: true },
      });
      if (!parent) break;
      titles.unshift(parent.title);
      cursor = parent.parentTaskId;
    }

    return titles;
  }

  private async loadDependencyResults(
    taskId: string,
  ): Promise<Array<{ title: string; summary: string; artifacts: string[] }>> {
    const deps = await this.prisma.taskDependency.findMany({
      where: { taskId },
      include: {
        dependsOn: {
          select: {
            id: true,
            title: true,
            resultSummary: true,
            runs: {
              select: {
                artifacts: { select: { path: true } },
              },
            },
          },
        },
      },
    });

    return deps.map((d) => {
      const artifactPaths = Array.from(
        new Set(
          (d.dependsOn.runs ?? []).flatMap((r) =>
            (r.artifacts ?? []).map((a) => a.path),
          ),
        ),
      );
      return {
        title: d.dependsOn.title,
        summary: (d.dependsOn.resultSummary ?? 'Completed').slice(0, 1200),
        artifacts: artifactPaths,
      };
    });
  }

  private async loadSpecialistSubtaskResults(
    studioId: string,
    taskId: string,
    parentTaskId: string | null,
  ): Promise<
    Array<{
      agentKey: string;
      title: string;
      status: string;
      summary: string;
      artifacts: string[];
    }>
  > {
    const anchorParentId = parentTaskId ?? taskId;
    const siblingsAndChildren = await this.prisma.task
      ?.findMany?.({
        where: {
          studioId,
          parentTaskId: anchorParentId,
          id: { not: taskId },
          status: { in: ['DONE', 'FAILED'] },
        },
        include: {
          agent: { select: { key: true } },
          runs: {
            select: {
              artifacts: { select: { path: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        take: 25,
      })
      .catch(() => []);

    return (siblingsAndChildren ?? []).map((t) => {
      const artifactPaths = Array.from(
        new Set(
          (t.runs ?? []).flatMap((r) => (r.artifacts ?? []).map((a) => a.path)),
        ),
      );
      return {
        agentKey: t.agent.key,
        title: t.title,
        status: t.status,
        summary: (t.resultSummary ?? 'Completed').slice(0, 800),
        artifacts: artifactPaths,
      };
    });
  }
}
