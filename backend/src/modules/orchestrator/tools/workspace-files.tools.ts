import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Injectable, Optional } from '@nestjs/common';
import type {
  CodingMode,
  CodingSyncTool,
  ContextMode,
  TerminalShell,
  ToolArgsOf,
} from '@robdev/shared';
import { RealtimeService } from '../../realtime/realtime.service.js';
import {
  analyzeLuauCode,
  normalizeArtifactForCodingMode,
  parseRobloxStudioTargetFromPath,
  syncScriptViaRobloxStudioMcp,
} from '../coding-mode-rules.js';
import {
  executeShellCommand,
  getWorkspaceRoots,
  isExternalPathApprovedInMeta,
  isPathInsideDirectory,
  isTerminalCommandApprovedInMeta,
  resolveWorkspaceOrExternalPath,
  type PendingPermissionAction,
} from './terminal-and-permissions.helper.js';
import type { ToolContext, ToolHandler, ToolResult } from './tool-context.js';

export interface WorkspaceFileEntry {
  path: string;
  bytes: number;
  className?: string;
  sourceRoot: 'workspace' | 'silicon' | 'artifact';
}

export async function getStudioCodingConfig(
  ctx: Pick<ToolContext, 'studioId' | 'prisma'>,
): Promise<{
  studioSlug: string;
  codingMode: CodingMode;
  codingSyncTool: CodingSyncTool;
  contextMode: ContextMode;
  allowTerminalWithoutPermission: boolean;
  allowExternalFilesWithoutPermission: boolean;
  workspaceRoot: string;
  siliconFallbackRoot: string | null;
}> {
  const studio = await ctx.prisma.studio
    ?.findUnique?.({
      where: { id: ctx.studioId },
      select: {
        slug: true,
        codingMode: true,
        codingSyncTool: true,
        contextMode: true,
        allowTerminalWithoutPermission: true,
        allowExternalFilesWithoutPermission: true,
      },
    })
    .catch(() => null);

  const studioSlug = studio?.slug ?? 'default';
  const codingMode = (studio?.codingMode as CodingMode) ?? 'LOCAL_SYNC';
  const codingSyncTool =
    (studio?.codingSyncTool as CodingSyncTool) ?? 'SILICON';
  const contextMode: ContextMode =
    studio?.contextMode === 'GENERAL' ? 'GENERAL' : 'ROBLOX';
  const allowTerminalWithoutPermission =
    studio?.allowTerminalWithoutPermission ?? false;
  const allowExternalFilesWithoutPermission =
    studio?.allowExternalFilesWithoutPermission ?? false;
  const { studioWorkspaceRoot: workspaceRoot } = getWorkspaceRoots(studioSlug);

  let siliconFallbackRoot: string | null = null;
  if (contextMode === 'ROBLOX' && codingSyncTool === 'SILICON') {
    const candidate = path.resolve('C:/Dev/Silicon');
    const hasGameDir = await fs
      .access(path.join(candidate, 'Game'))
      .then(() => true)
      .catch(() => false);
    if (hasGameDir) {
      siliconFallbackRoot = candidate;
    }
  }

  return {
    studioSlug,
    codingMode,
    codingSyncTool,
    contextMode,
    allowTerminalWithoutPermission,
    allowExternalFilesWithoutPermission,
    workspaceRoot,
    siliconFallbackRoot,
  };
}

async function walkDirectory(
  rootDir: string,
  relPrefix: string,
  currentDepth: number,
  maxDepth: number,
  sourceRoot: 'workspace' | 'silicon',
  out: Map<string, WorkspaceFileEntry>,
): Promise<void> {
  if (currentDepth > maxDepth || out.size >= 400) return;
  const currentAbs = relPrefix ? path.join(rootDir, relPrefix) : rootDir;
  const entries = await fs
    .readdir(currentAbs, { withFileTypes: true })
    .catch(() => []);

  for (const entry of entries) {
    if (
      entry.name.startsWith('.') ||
      entry.name === 'node_modules' ||
      entry.name === '__pycache__'
    ) {
      continue;
    }
    const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walkDirectory(
        rootDir,
        relPath,
        currentDepth + 1,
        maxDepth,
        sourceRoot,
        out,
      );
    } else if (entry.isFile()) {
      if (out.has(relPath)) continue;
      const absFile = path.join(rootDir, relPath);
      const stat = await fs.stat(absFile).catch(() => null);
      let className: string | undefined;
      if (entry.name.toLowerCase() === 'properties.yaml') {
        const raw = await fs.readFile(absFile, 'utf8').catch(() => '');
        const match = /^ClassName:\s*(\S+)/m.exec(raw);
        if (match?.[1]) className = match[1];
      }
      out.set(relPath, {
        path: relPath,
        bytes: stat?.size ?? 0,
        ...(className ? { className } : {}),
        sourceRoot,
      });
    }
  }
}

export async function collectWorkspaceFileEntries(
  ctx: ToolContext,
  subDir = '',
  maxDepth = 5,
): Promise<WorkspaceFileEntry[]> {
  const cfg = await getStudioCodingConfig(ctx);
  const cleanSub = subDir
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s.length > 0 && s !== '.' && s !== '..')
    .join('/');

  const map = new Map<string, WorkspaceFileEntry>();

  await walkDirectory(
    cfg.workspaceRoot,
    cleanSub,
    0,
    maxDepth,
    'workspace',
    map,
  );

  // Also include recent RunArtifact files from the database for this studio
  const dbArtifacts = await ctx.prisma.runArtifact
    ?.findMany?.({
      where: {
        run: { studioId: ctx.studioId },
      },
      orderBy: { createdAt: 'desc' },
      take: 150,
      select: { path: true, bytes: true },
    })
    .catch(() => []);

  for (const art of dbArtifacts ?? []) {
    const norm = art.path.replace(/\\/g, '/');
    if (cleanSub && !norm.startsWith(cleanSub)) continue;
    if (!map.has(norm)) {
      map.set(norm, {
        path: norm,
        bytes: art.bytes,
        sourceRoot: 'artifact',
      });
    }
  }

  // If workspace is empty or user also has C:/Dev/Silicon/Game, include Silicon Game files
  if (cfg.siliconFallbackRoot && map.size < 250) {
    const startRel = cleanSub || 'Game';
    await walkDirectory(
      cfg.siliconFallbackRoot,
      startRel,
      0,
      maxDepth,
      'silicon',
      map,
    );
  }

  return Array.from(map.values()).sort((a, b) => a.path.localeCompare(b.path));
}

export function extractLuauPublicSignatures(content: string): string[] {
  const signatures: string[] = [];
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^export\s+type\s+[A-Za-z0-9_]+/.test(line)) {
      signatures.push(line.replace(/\s*=\s*\{.*$/, ' = { ... }').slice(0, 110));
    } else if (
      /^function\s+[A-Za-z0-9_]+[.:][A-Za-z0-9_]+\s*\(/.test(line)
    ) {
      signatures.push(line.slice(0, 110));
    }
    if (signatures.length >= 6) break;
  }
  return signatures;
}

/**
 * Builds a compact summary of workspace files (including exported Luau types & module signatures)
 * to inject into `[CONTEXT]` in PromptResolverService.
 */
export async function buildCompactWorkspaceTree(
  ctx: Pick<ToolContext, 'studioId' | 'prisma'>,
): Promise<string | null> {
  const entries = await collectWorkspaceFileEntries(
    ctx as ToolContext,
    '',
    5,
  ).catch(() => []);
  if (entries.length === 0) return null;

  const lines: string[] = [];
  let signatureFilesCount = 0;

  for (const e of entries.slice(0, 80)) {
    const tag = e.className ? ` [${e.className}]` : '';
    lines.push(`  - ${e.path} (${e.bytes}B)${tag}`);

    if (
      signatureFilesCount < 20 &&
      /\.(?:luau|lua)$/i.test(e.path) &&
      e.sourceRoot !== 'silicon'
    ) {
      const loaded = await readWorkspaceFileContent(
        ctx as ToolContext,
        e.path,
      ).catch(() => null);
      if (loaded) {
        const sigs = extractLuauPublicSignatures(loaded.content);
        if (sigs.length > 0) {
          signatureFilesCount += 1;
          for (const sig of sigs) {
            lines.push(`      • ${sig}`);
          }
        }
      }
    }
  }

  if (entries.length > 80) {
    lines.push(
      `  ... (${entries.length - 80} more files; call list_workspace_files or grep_workspace to explore)`,
    );
  }
  return [
    'Workspace Files & Exported Luau Signatures (use read_workspace_file / grep_workspace / edit_workspace_file to inspect or modify):',
    ...lines,
  ].join('\n');
}

export async function readWorkspaceFileContent(
  ctx: Pick<ToolContext, 'studioId' | 'prisma'> & {
    task?: { metadata: Record<string, unknown> | null };
  },
  requestedPath: string,
): Promise<{
  resolvedPath: string;
  content: string;
  sourceRoot: 'workspace' | 'silicon' | 'artifact';
} | null> {
  const readOnlyExternal = Array.isArray(ctx.task?.metadata?.['readOnlyExternalPaths'])
    ? (ctx.task!.metadata!['readOnlyExternalPaths'] as string[])
    : [];
  if (readOnlyExternal.length > 0) {
    const trimmed = requestedPath.trim();
    const isAbs = /^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith('/');
    for (const allowedDir of readOnlyExternal) {
      const candidateAbs = isAbs
        ? path.resolve(trimmed)
        : path.resolve(allowedDir, trimmed);
      if (isPathInsideDirectory(candidateAbs, allowedDir)) {
        const content = await fs.readFile(candidateAbs, 'utf8').catch(() => null);
        if (content !== null) {
          return {
            resolvedPath: candidateAbs.replace(/\\/g, '/'),
            content,
            sourceRoot: 'workspace',
          };
        }
      }
    }
  }

  const cfg = await getStudioCodingConfig(ctx);
  const cleanRel = requestedPath
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s.length > 0 && s !== '.' && s !== '..')
    .join('/');

  if (!cleanRel) return null;

  // Candidate paths to check (exact path + normalized Silicon path if applicable)
  const candidates = [cleanRel];
  if (
    cfg.contextMode === 'ROBLOX' &&
    cfg.codingSyncTool === 'SILICON' &&
    !cleanRel.toLowerCase().startsWith('game/')
  ) {
    candidates.push(`Game/${cleanRel}`);
  }
  const normalizedPlan = normalizeArtifactForCodingMode({
    path: cleanRel,
    language: /\.(?:luau|lua)$/i.test(cleanRel) ? 'luau' : 'text',
    content: '',
    codingMode: cfg.codingMode,
    codingSyncTool: cfg.codingSyncTool,
    contextMode: cfg.contextMode,
  });
  if (!candidates.includes(normalizedPlan.normalizedPath)) {
    candidates.push(normalizedPlan.normalizedPath);
  }

  // 1. Check studio workspace disk
  for (const cand of candidates) {
    const abs = path.resolve(cfg.workspaceRoot, cand.split('/').join(path.sep));
    if (abs.startsWith(cfg.workspaceRoot)) {
      const content = await fs.readFile(abs, 'utf8').catch(() => null);
      if (content !== null) {
        return { resolvedPath: cand, content, sourceRoot: 'workspace' };
      }
    }
  }

  // 2. Check database RunArtifact records
  for (const cand of candidates) {
    const artifact = await ctx.prisma.runArtifact
      ?.findFirst?.({
        where: {
          path: cand,
          run: { studioId: ctx.studioId },
        },
        orderBy: { createdAt: 'desc' },
        select: { path: true, content: true },
      })
      .catch(() => null);
    if (artifact) {
      return {
        resolvedPath: artifact.path,
        content: artifact.content,
        sourceRoot: 'artifact',
      };
    }
  }

  // 3. Check C:/Dev/Silicon fallback
  if (cfg.siliconFallbackRoot) {
    for (const cand of candidates) {
      const abs = path.resolve(
        cfg.siliconFallbackRoot,
        cand.split('/').join(path.sep),
      );
      if (abs.startsWith(cfg.siliconFallbackRoot)) {
        const content = await fs.readFile(abs, 'utf8').catch(() => null);
        if (content !== null) {
          return { resolvedPath: cand, content, sourceRoot: 'silicon' };
        }
      }
    }
  }

  return null;
}

@Injectable()
export class ListWorkspaceFilesTool
  implements ToolHandler<'list_workspace_files'>
{
  readonly name = 'list_workspace_files' as const;

  async execute(
    args: ToolArgsOf<'list_workspace_files'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const files = await collectWorkspaceFileEntries(
      ctx,
      args.directory,
      args.maxDepth,
    );
    return {
      payload: {
        ok: true,
        directory: args.directory || '/',
        totalFiles: files.length,
        files: files.slice(0, 200),
      },
    };
  }
}

@Injectable()
export class ReadWorkspaceFileTool
  implements ToolHandler<'read_workspace_file'>
{
  readonly name = 'read_workspace_file' as const;

  async execute(
    args: ToolArgsOf<'read_workspace_file'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const found = await readWorkspaceFileContent(ctx, args.path);
    if (!found) {
      return {
        payload: {
          ok: false,
          error: 'FILE_NOT_FOUND',
          message: `File "${args.path}" not found in workspace. Call list_workspace_files to inspect available paths.`,
        },
      };
    }

    const allLines = found.content.split(/\r?\n/);
    const totalLines = allLines.length;
    const startLine = Math.max(1, args.startLine ?? 1);
    const requestedEnd = args.endLine ?? startLine + 649;
    const endLine = Math.min(
      totalLines,
      Math.min(requestedEnd, startLine + 749),
    );

    const sliced = allLines
      .slice(startLine - 1, endLine)
      .map((line, i) => `${startLine + i}: ${line}`)
      .join('\n');

    return {
      payload: {
        ok: true,
        path: found.resolvedPath,
        sourceRoot: found.sourceRoot,
        totalLines,
        startLine,
        endLine,
        ...(endLine < totalLines
          ? { hasMore: true, nextStartLine: endLine + 1 }
          : {}),
        contentWithLineNumbers: sliced,
      },
    };
  }
}

@Injectable()
export class GrepWorkspaceTool implements ToolHandler<'grep_workspace'> {
  readonly name = 'grep_workspace' as const;

  async execute(
    args: ToolArgsOf<'grep_workspace'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const files = await collectWorkspaceFileEntries(
      ctx,
      args.pathFilter ?? '',
      6,
    );

    let regex: RegExp;
    try {
      regex = new RegExp(args.pattern, args.caseSensitive ? '' : 'i');
    } catch {
      const escaped = args.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      regex = new RegExp(escaped, args.caseSensitive ? '' : 'i');
    }

    const matches: Array<{
      path: string;
      lineNumber: number;
      line: string;
      contextBefore: string;
      contextAfter: string;
    }> = [];

    for (const file of files) {
      if (matches.length >= args.maxResults) break;
      const loaded = await readWorkspaceFileContent(ctx, file.path);
      if (!loaded) continue;

      const lines = loaded.content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i]!)) {
          matches.push({
            path: loaded.resolvedPath,
            lineNumber: i + 1,
            line: lines[i]!.slice(0, 240),
            contextBefore: (lines[i - 1] ?? '').slice(0, 160),
            contextAfter: (lines[i + 1] ?? '').slice(0, 160),
          });
          if (matches.length >= args.maxResults) break;
        }
      }
    }

    return {
      payload: {
        ok: true,
        pattern: args.pattern,
        matchCount: matches.length,
        matches,
      },
    };
  }
}

@Injectable()
export class EditWorkspaceFileTool
  implements ToolHandler<'edit_workspace_file'>
{
  readonly name = 'edit_workspace_file' as const;

  constructor(@Optional() private readonly realtime?: RealtimeService) {}

  async execute(
    args: ToolArgsOf<'edit_workspace_file'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const cfg = await getStudioCodingConfig(ctx);
    const targetCheck = resolveWorkspaceOrExternalPath(
      args.path,
      cfg.studioSlug,
    );

    let existing: {
      resolvedPath: string;
      content: string;
      sourceRoot: 'workspace' | 'silicon' | 'artifact';
    } | null = null;

    if (!targetCheck.isInsideWorkspace) {
      const extContent = await fs
        .readFile(targetCheck.absPath, 'utf8')
        .catch(() => null);
      if (extContent !== null) {
        existing = {
          resolvedPath: targetCheck.workspaceRelativePath,
          content: extContent,
          sourceRoot: 'workspace',
        };
      }
    } else {
      existing = await readWorkspaceFileContent(ctx, args.path);
    }

    if (!existing) {
      return {
        payload: {
          ok: false,
          error: 'FILE_NOT_FOUND',
          message: `Cannot edit "${args.path}" because it does not exist yet. Use save_artifact to create a new file or read_workspace_file to verify the path.`,
        },
      };
    }

    // Normalize CRLF vs LF so target matching works reliably across platforms
    const normalizedExisting = existing.content.replace(/\r\n/g, '\n');
    const normalizedTarget = args.target.replace(/\r\n/g, '\n');
    const normalizedReplacement = args.replacement.replace(/\r\n/g, '\n');

    if (!normalizedExisting.includes(normalizedTarget)) {
      return {
        payload: {
          ok: false,
          error: 'TARGET_NOT_FOUND',
          message: `The \`target\` string was not found in "${existing.resolvedPath}". Call \`read_workspace_file\` to inspect the exact current lines before calling \`edit_workspace_file\`.`,
        },
      };
    }

    const updatedContent = args.replaceAll
      ? normalizedExisting.split(normalizedTarget).join(normalizedReplacement)
      : normalizedExisting.replace(normalizedTarget, normalizedReplacement);

    const extLanguage = /\.(?:luau|lua)$/i.test(existing.resolvedPath)
      ? 'luau'
      : /\.ts$|\.tsx$/i.test(existing.resolvedPath)
        ? 'typescript'
        : /\.js$|\.jsx$/i.test(existing.resolvedPath)
          ? 'javascript'
          : /\.py$/i.test(existing.resolvedPath)
            ? 'python'
            : /\.yaml|\.yml$/i.test(existing.resolvedPath)
              ? 'yaml'
              : /\.json$/i.test(existing.resolvedPath)
                ? 'json'
                : /\.md$/i.test(existing.resolvedPath)
                  ? 'markdown'
                  : 'text';

    const bytes = Buffer.byteLength(updatedContent, 'utf8');

    // Enforce permission gate if editing a file outside /workspace/
    if (!targetCheck.isInsideWorkspace) {
      const alreadyApproved = isExternalPathApprovedInMeta(
        ctx.task.metadata,
        targetCheck.absPath,
      );
      if (!cfg.allowExternalFilesWithoutPermission && !alreadyApproved) {
        return this.requestExternalEditPermission(
          args,
          ctx,
          targetCheck.absPath,
          extLanguage,
          updatedContent,
          bytes,
        );
      }

      await fs.mkdir(path.dirname(targetCheck.absPath), { recursive: true });
      await fs.writeFile(targetCheck.absPath, updatedContent, 'utf8');

      const artifact = await ctx.prisma.runArtifact.create({
        data: {
          runId: ctx.run.id,
          path: targetCheck.workspaceRelativePath,
          language: extLanguage,
          content: updatedContent,
          bytes,
          agentComment: args.comment ?? null,
        },
        select: { id: true, path: true, bytes: true },
      });

      if (args.comment) {
        await ctx.prisma.workspaceFileComment
          ?.create?.({
            data: {
              studioId: ctx.studioId,
              filePath: targetCheck.workspaceRelativePath,
              authorKind: 'AGENT',
              agentId: ctx.agent.id,
              agentKey: ctx.agent.key,
              runId: ctx.run.id,
              taskId: ctx.task.id,
              body: args.comment,
            },
          })
          .catch(() => null);
      }

      return {
        payload: {
          ok: true,
          artifactId: artifact.id,
          path: artifact.path,
          diskPath: targetCheck.absPath,
          bytes,
          outsideWorkspace: true,
        },
      };
    }

    const plan = normalizeArtifactForCodingMode({
      path: existing.resolvedPath,
      language: extLanguage,
      content: updatedContent,
      codingMode: cfg.codingMode,
      codingSyncTool: cfg.codingSyncTool,
      contextMode: cfg.contextMode,
    });
    const effectivePath = plan.normalizedPath;

    const artifact = await ctx.prisma.runArtifact.create({
      data: {
        runId: ctx.run.id,
        path: effectivePath,
        language: extLanguage,
        content: updatedContent,
        bytes,
        agentComment: args.comment ?? null,
      },
      select: { id: true, path: true, bytes: true },
    });

    if (args.comment) {
      await ctx.prisma.workspaceFileComment
        ?.create?.({
          data: {
            studioId: ctx.studioId,
            filePath: effectivePath,
            authorKind: 'AGENT',
            agentId: ctx.agent.id,
            agentKey: ctx.agent.key,
            runId: ctx.run.id,
            taskId: ctx.task.id,
            body: args.comment,
          },
        })
        .catch(() => null);
    }

    const sanitizedRel = effectivePath
      .replace(/\\/g, '/')
      .split('/')
      .filter((seg) => seg.length > 0 && seg !== '.' && seg !== '..')
      .join(path.sep);
    const diskPath = path.resolve(cfg.workspaceRoot, sanitizedRel);

    if (diskPath.startsWith(cfg.workspaceRoot)) {
      await fs.mkdir(path.dirname(diskPath), { recursive: true });
      await fs.writeFile(diskPath, updatedContent, 'utf8');
    }

    for (const companion of plan.companionFiles) {
      const compRel = companion.relativePath
        .replace(/\\/g, '/')
        .split('/')
        .filter((seg: string) => seg.length > 0 && seg !== '.' && seg !== '..')
        .join(path.sep);
      const compDiskPath = path.resolve(cfg.workspaceRoot, compRel);
      if (compDiskPath.startsWith(cfg.workspaceRoot)) {
        await fs.mkdir(path.dirname(compDiskPath), { recursive: true });
        if (!companion.overwriteIfExisting) {
          const exists = await fs
            .access(compDiskPath)
            .then(() => true)
            .catch(() => false);
          if (exists) continue;
        }
        await fs.writeFile(compDiskPath, companion.content, 'utf8');
      }
    }

    let robloxMcpStatus:
      | { synced: boolean; studioId?: string; message: string }
      | undefined;

    if (cfg.contextMode === 'ROBLOX' && cfg.codingMode === 'ROBLOX_MCP') {
      const mcpTarget = parseRobloxStudioTargetFromPath(effectivePath);
      if (mcpTarget) {
        robloxMcpStatus = await syncScriptViaRobloxStudioMcp(
          mcpTarget,
          updatedContent,
        );
      }
    }

    const luauDiagnostics =
      cfg.contextMode === 'ROBLOX' && extLanguage === 'luau'
        ? analyzeLuauCode(updatedContent, effectivePath)
        : undefined;

    await ctx.log.entry(
      'SYSTEM',
      `Edited file artifact: ${effectivePath} (${bytes} bytes)`,
      {
        createdArtifact: {
          kind: 'artifact',
          id: artifact.id,
          path: effectivePath,
          language: extLanguage,
          content: updatedContent.slice(0, 12000),
          bytes,
          agentComment: args.comment ?? null,
        },
        ...(robloxMcpStatus ? { robloxMcp: robloxMcpStatus } : {}),
        ...(luauDiagnostics && luauDiagnostics.issues.length > 0
          ? { luauDiagnostics }
          : {}),
      },
    );

    return {
      payload: {
        ok: true,
        artifactId: artifact.id,
        path: effectivePath,
        diskPath,
        bytes,
        ...(args.comment ? { agentComment: args.comment } : {}),
        ...(robloxMcpStatus ? { robloxMcp: robloxMcpStatus } : {}),
        ...(luauDiagnostics
          ? {
              luauDiagnostics,
              ...(luauDiagnostics.issues.length > 0
                ? {
                    verificationNotice:
                      'Diagnostics found issues in the edited Luau script. Review `luauDiagnostics.issues` and fix any errors before concluding.',
                  }
                : {}),
            }
          : {}),
      },
    };
  }

  private async requestExternalEditPermission(
    args: ToolArgsOf<'edit_workspace_file'>,
    ctx: ToolContext,
    absPath: string,
    language: string,
    updatedContent: string,
    bytes: number,
  ): Promise<ToolResult> {
    const title = `Permission Required: Edit file outside /workspace/`;
    const body = [
      `**${ctx.userFacingAgentName}** is requesting permission to edit a file **outside** the \`/workspace/\` directory:`,
      `- **Target Path**: \`${absPath}\``,
      `- **Updated Size**: ${bytes} bytes`,
      args.comment ? `- **Agent Note**: ${args.comment}` : '',
      '',
      'Approve to write the updated file to disk and continue, or deny to block the external edit.',
    ]
      .filter(Boolean)
      .join('\n');

    const options = [
      {
        id: 'approve',
        label: 'Approve External File Edit',
        description: `Allow editing ${absPath} and continue`,
      },
      {
        id: 'deny',
        label: 'Deny Edit',
        description: 'Do not modify files outside /workspace/',
      },
    ];

    const reqRow = await ctx.prisma.humanRequest
      ?.create?.({
        data: {
          studioId: ctx.studioId,
          gameId: ctx.game?.id ?? null,
          taskId: ctx.task.id,
          agentId: ctx.agent.id,
          kind: 'DECISION',
          status: 'OPEN',
          title,
          body,
          options: options as object,
        },
      })
      .catch(() => null);

    const requestId = reqRow?.id ?? `perm_ext_edit_${Date.now()}`;

    const currentMeta =
      typeof ctx.task.metadata === 'object' && ctx.task.metadata !== null
        ? { ...(ctx.task.metadata as Record<string, unknown>) }
        : {};
    const pendingMap: Record<string, PendingPermissionAction> =
      typeof currentMeta['pendingPermissions'] === 'object' &&
      currentMeta['pendingPermissions'] !== null
        ? {
            ...(currentMeta['pendingPermissions'] as Record<
              string,
              PendingPermissionAction
            >),
          }
        : {};

    pendingMap[requestId] = {
      requestId,
      type: 'EXTERNAL_FILE_WRITE',
      status: 'PENDING',
      absPath,
      displayPath: absPath.replace(/\\/g, '/'),
      language,
      content: updatedContent,
      comment: args.comment ?? null,
      runId: ctx.run.id,
      agentId: ctx.agent.id,
      agentKey: ctx.agent.key,
      createdAt: new Date().toISOString(),
    };
    currentMeta['pendingPermissions'] = pendingMap;
    ctx.task.metadata = currentMeta;

    await ctx.prisma.task
      ?.update?.({
        where: { id: ctx.task.id },
        data: { status: 'NEEDS_HUMAN', metadata: currentMeta as object },
      })
      .catch(() => null);

    await ctx.prisma.agentMessage
      ?.create?.({
        data: {
          studioId: ctx.studioId,
          agentId: ctx.agent.id,
          taskId: ctx.task.id,
          author: 'AGENT',
          body: `**[PERMISSION REQUIRED: EXTERNAL FILE EDIT]**\n${body}`,
        },
      })
      .catch(() => null);

    await ctx.log.entry(
      'SYSTEM',
      `Permission requested to edit file outside /workspace/: ${absPath} (req ${requestId})`,
    );

    if (this.realtime && reqRow) {
      this.realtime.emitToStudio(ctx.studioId, 'human-request:updated', {
        request: {
          id: reqRow.id,
          kind: reqRow.kind,
          status: reqRow.status,
          title: reqRow.title,
          body: reqRow.body,
          gameId: reqRow.gameId,
          agentKey: ctx.agent.key,
          taskId: reqRow.taskId,
          options: options.map((o) => ({ id: o.id, label: o.label })),
          pitchIds: [],
          buildVersion: null,
          resolution: null,
          createdAt: reqRow.createdAt.toISOString(),
          resolvedAt: null,
        },
        change: 'created',
      });
      this.realtime.broadcastCounts(ctx.studioId);
    }

    return {
      payload: {
        ok: false,
        status: 'AWAITING_PERMISSION',
        requestId,
        path: absPath,
        message:
          'Editing files outside /workspace/ requires human permission. Paused run until the operator approves or denies.',
      },
      control: 'await-human',
    };
  }
}

@Injectable()
export class CommentWorkspaceFileTool
  implements ToolHandler<'comment_workspace_file'>
{
  readonly name = 'comment_workspace_file' as const;

  async execute(
    args: ToolArgsOf<'comment_workspace_file'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const cfg = await getStudioCodingConfig(ctx);
    const targetCheck = resolveWorkspaceOrExternalPath(
      args.path,
      cfg.studioSlug,
    );
    const filePath = targetCheck.workspaceRelativePath;

    const row = await ctx.prisma.workspaceFileComment
      ?.create?.({
        data: {
          studioId: ctx.studioId,
          filePath,
          authorKind: 'AGENT',
          agentId: ctx.agent.id,
          agentKey: ctx.agent.key,
          runId: ctx.run.id,
          taskId: ctx.task.id,
          body: args.comment,
          lineStart: args.lineStart ?? null,
          lineEnd: args.lineEnd ?? null,
        },
      })
      .catch(() => null);

    await ctx.log.entry(
      'SYSTEM',
      `Added file comment on ${filePath}: "${args.comment.slice(0, 120)}"`,
    );

    return {
      payload: {
        ok: true,
        commentId: row?.id ?? `comment_${Date.now()}`,
        path: filePath,
        comment: args.comment,
        lineStart: args.lineStart ?? null,
        lineEnd: args.lineEnd ?? null,
      },
    };
  }
}

@Injectable()
export class RunTerminalCommandTool
  implements ToolHandler<'run_terminal_command'>
{
  readonly name = 'run_terminal_command' as const;

  constructor(@Optional() private readonly realtime?: RealtimeService) {}

  async execute(
    args: ToolArgsOf<'run_terminal_command'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const cfg = await getStudioCodingConfig(ctx);
    const shell: TerminalShell = args.shell ?? 'powershell';
    const timeoutMs = args.timeoutMs ?? 30_000;

    // Resolve working directory (defaults to /workspace/<studioSlug>)
    let resolvedCwd = cfg.workspaceRoot;
    if (args.cwd && args.cwd.trim()) {
      const cwdCheck = resolveWorkspaceOrExternalPath(
        args.cwd.trim(),
        cfg.studioSlug,
      );
      resolvedCwd = cwdCheck.absPath;
    }

    const alreadyApproved = isTerminalCommandApprovedInMeta(
      ctx.task.metadata,
      shell,
      args.command,
    );

    // ALWAYS first ask for permission unless Settings -> allowTerminalWithoutPermission is enabled (or already approved)
    if (!cfg.allowTerminalWithoutPermission && !alreadyApproved) {
      return this.requestTerminalPermission(
        args,
        ctx,
        shell,
        resolvedCwd,
        timeoutMs,
      );
    }

    await ctx.log.entry(
      'SYSTEM',
      `Executing terminal command on ${shell}: ${args.command.slice(0, 180)}`,
    );

    const execRes = await executeShellCommand({
      command: args.command,
      shell,
      cwd: resolvedCwd,
      timeoutMs,
      signal: ctx.signal,
    });

    await ctx.log.entry(
      'SYSTEM',
      `Terminal command finished (${shell}, exit ${execRes.exitCode ?? 'timeout'}, ${execRes.durationMs}ms)`,
    );

    return {
      payload: {
        ok: execRes.ok,
        executed: true,
        shell: execRes.shell,
        command: execRes.command,
        cwd: execRes.cwd,
        exitCode: execRes.exitCode,
        durationMs: execRes.durationMs,
        timedOut: execRes.timedOut,
        stdout: execRes.stdout,
        stderr: execRes.stderr,
      },
    };
  }

  private async requestTerminalPermission(
    args: ToolArgsOf<'run_terminal_command'>,
    ctx: ToolContext,
    shell: TerminalShell,
    cwd: string,
    timeoutMs: number,
  ): Promise<ToolResult> {
    const title = `Permission Required: Run ${shell} command`;
    const body = [
      `**${ctx.userFacingAgentName}** is asking for permission to execute a terminal command:`,
      `- **Shell**: \`${shell}\``,
      `- **Working Directory**: \`${cwd}\``,
      args.reason ? `- **Reason**: ${args.reason}` : '',
      '```sh',
      args.command,
      '```',
      'Approve to execute this command now and return its output to the agent, or deny to block execution.',
    ]
      .filter(Boolean)
      .join('\n');

    const options = [
      {
        id: 'approve',
        label: 'Approve & Execute Command',
        description: `Execute on ${shell} and resume the agent`,
      },
      {
        id: 'deny',
        label: 'Deny Command',
        description: 'Do not execute this command',
      },
    ];

    const reqRow = await ctx.prisma.humanRequest
      ?.create?.({
        data: {
          studioId: ctx.studioId,
          gameId: ctx.game?.id ?? null,
          taskId: ctx.task.id,
          agentId: ctx.agent.id,
          kind: 'DECISION',
          status: 'OPEN',
          title,
          body,
          options: options as object,
        },
      })
      .catch(() => null);

    const requestId = reqRow?.id ?? `perm_cmd_${Date.now()}`;

    const currentMeta =
      typeof ctx.task.metadata === 'object' && ctx.task.metadata !== null
        ? { ...(ctx.task.metadata as Record<string, unknown>) }
        : {};
    const pendingMap: Record<string, PendingPermissionAction> =
      typeof currentMeta['pendingPermissions'] === 'object' &&
      currentMeta['pendingPermissions'] !== null
        ? {
            ...(currentMeta['pendingPermissions'] as Record<
              string,
              PendingPermissionAction
            >),
          }
        : {};

    pendingMap[requestId] = {
      requestId,
      type: 'TERMINAL_COMMAND',
      status: 'PENDING',
      shell,
      command: args.command,
      cwd,
      timeoutMs,
      reason: args.reason ?? null,
      runId: ctx.run.id,
      agentId: ctx.agent.id,
      agentKey: ctx.agent.key,
      createdAt: new Date().toISOString(),
    };
    currentMeta['pendingPermissions'] = pendingMap;
    ctx.task.metadata = currentMeta;

    await ctx.prisma.task
      ?.update?.({
        where: { id: ctx.task.id },
        data: { status: 'NEEDS_HUMAN', metadata: currentMeta as object },
      })
      .catch(() => null);

    await ctx.prisma.agentMessage
      ?.create?.({
        data: {
          studioId: ctx.studioId,
          agentId: ctx.agent.id,
          taskId: ctx.task.id,
          author: 'AGENT',
          body: `**[PERMISSION REQUIRED: TERMINAL COMMAND]**\n${body}`,
        },
      })
      .catch(() => null);

    await ctx.log.entry(
      'SYSTEM',
      `Permission requested to execute ${shell} command: ${args.command.slice(0, 140)} (req ${requestId})`,
    );

    if (this.realtime && reqRow) {
      this.realtime.emitToStudio(ctx.studioId, 'human-request:updated', {
        request: {
          id: reqRow.id,
          kind: reqRow.kind,
          status: reqRow.status,
          title: reqRow.title,
          body: reqRow.body,
          gameId: reqRow.gameId,
          agentKey: ctx.agent.key,
          taskId: reqRow.taskId,
          options: options.map((o) => ({ id: o.id, label: o.label })),
          pitchIds: [],
          buildVersion: null,
          resolution: null,
          createdAt: reqRow.createdAt.toISOString(),
          resolvedAt: null,
        },
        change: 'created',
      });
      this.realtime.broadcastCounts(ctx.studioId);
    }

    return {
      payload: {
        ok: false,
        status: 'AWAITING_PERMISSION',
        requestId,
        shell,
        command: args.command,
        cwd,
        message:
          'Terminal command execution requires human permission first. Paused run until the operator approves or denies the command.',
      },
      control: 'await-human',
    };
  }
}
