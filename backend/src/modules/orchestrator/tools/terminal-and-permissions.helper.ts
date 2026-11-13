import { spawn } from 'node:child_process';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AgentKey, TerminalShell } from '@robdev/shared';
import type { PrismaService } from '../../../prisma/prisma.service.js';

export interface ResolvedWorkspaceTarget {
  /** Absolute path on disk */
  absPath: string;
  /** Forward-slash path relative to studio workspace root (or full path if outside) */
  workspaceRelativePath: string;
  /** True if inside `/workspace/<studioSlug>` or `/workspace/` */
  isInsideWorkspace: boolean;
  /** Studio workspace root directory (`.../workspace/<studioSlug>`) */
  studioWorkspaceRoot: string;
  /** Top-level `/workspace` directory (`.../workspace`) */
  topWorkspaceRoot: string;
}

export interface ShellExecutionResult {
  ok: boolean;
  shell: TerminalShell;
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface PendingTerminalPermission {
  requestId: string;
  type: 'TERMINAL_COMMAND';
  status: 'PENDING' | 'EXECUTED' | 'DENIED';
  shell: TerminalShell;
  command: string;
  cwd: string;
  timeoutMs: number;
  reason: string | null;
  runId: string;
  agentId: string;
  agentKey: AgentKey;
  createdAt: string;
}

export interface PendingExternalFilePermission {
  requestId: string;
  type: 'EXTERNAL_FILE_WRITE';
  status: 'PENDING' | 'EXECUTED' | 'DENIED';
  absPath: string;
  displayPath: string;
  language: string;
  content: string;
  comment: string | null;
  runId: string;
  agentId: string;
  agentKey: AgentKey;
  createdAt: string;
}

export type PendingPermissionAction =
  | PendingTerminalPermission
  | PendingExternalFilePermission;

export function getWorkspaceRoots(studioSlug: string): {
  topWorkspaceRoot: string;
  studioWorkspaceRoot: string;
} {
  const cwd = process.cwd();
  const repoRoot =
    path.basename(cwd).toLowerCase() === 'backend'
      ? path.resolve(cwd, '..')
      : cwd;
  const topWorkspaceRoot = path.resolve(repoRoot, 'workspace');
  const slug = studioSlug || 'default';
  const candidateSlugDir = path.resolve(topWorkspaceRoot, slug);
  const ervumGamesDir = path.resolve(topWorkspaceRoot, 'ervum-games');

  if (
    slug !== 'test-studio' &&
    slug !== 'sandbox' &&
    (slug === 'inclined-games' ||
      slug === 'ervum-games' ||
      !fsSync.existsSync(candidateSlugDir)) &&
    fsSync.existsSync(ervumGamesDir)
  ) {
    return { topWorkspaceRoot, studioWorkspaceRoot: ervumGamesDir };
  }

  return { topWorkspaceRoot, studioWorkspaceRoot: candidateSlugDir };
}

export function isPathInsideDirectory(
  candidateAbsPath: string,
  rootDirAbsPath: string,
): boolean {
  const normCandidate = path
    .resolve(candidateAbsPath)
    .replace(/\\/g, '/')
    .toLowerCase();
  const normRoot = path
    .resolve(rootDirAbsPath)
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
  return (
    normCandidate === normRoot || normCandidate.startsWith(`${normRoot}/`)
  );
}

/**
 * Resolves a requested file path and determines whether it lives inside `/workspace/`
 * (where agents can create/edit files without permission) or outside `/workspace/`
 * (where agents must ALWAYS first ask for permission unless `allowExternalFilesWithoutPermission` is enabled).
 */
export function resolveWorkspaceOrExternalPath(
  rawPath: string,
  studioSlug: string,
): ResolvedWorkspaceTarget {
  const { topWorkspaceRoot, studioWorkspaceRoot } =
    getWorkspaceRoots(studioSlug);
  const trimmed = rawPath.trim();
  const slashNormalized = trimmed.replace(/\\/g, '/');

  // Check if the path is a virtual "/workspace/..." reference (not a real Unix root path outside workspace)
  const virtualWorkspaceMatch = /^\/?workspace(?:\/([^/]+))?(?:\/(.*))?$/i.exec(
    slashNormalized,
  );
  if (virtualWorkspaceMatch) {
    const firstSeg = virtualWorkspaceMatch[1] ?? '';
    const rest = virtualWorkspaceMatch[2] ?? '';
    const studioFolderBase = path.basename(studioWorkspaceRoot).toLowerCase();
    const relativeInner =
      firstSeg.toLowerCase() === studioSlug.toLowerCase() ||
      firstSeg.toLowerCase() === studioFolderBase
        ? rest
        : [firstSeg, rest].filter(Boolean).join('/');
    const absPath = path.resolve(
      studioWorkspaceRoot,
      relativeInner || 'artifact.txt',
    );
    const isInside =
      isPathInsideDirectory(absPath, studioWorkspaceRoot) ||
      isPathInsideDirectory(absPath, topWorkspaceRoot);
    const rel = isPathInsideDirectory(absPath, studioWorkspaceRoot)
      ? path.relative(studioWorkspaceRoot, absPath).replace(/\\/g, '/')
      : absPath.replace(/\\/g, '/');
    return {
      absPath,
      workspaceRelativePath: rel || 'artifact.txt',
      isInsideWorkspace: isInside,
      studioWorkspaceRoot,
      topWorkspaceRoot,
    };
  }

  // Check Windows drive-letter absolute path (e.g. C:/... or D:\...) or POSIX absolute path (e.g. /tmp/..., /etc/...)
  const isWinDriveAbs = /^[a-zA-Z]:[\\/]/.test(trimmed);
  const isPosixAbs = slashNormalized.startsWith('/');

  let absPath: string;
  if (isWinDriveAbs || isPosixAbs) {
    absPath = path.resolve(trimmed);
  } else {
    absPath = path.resolve(studioWorkspaceRoot, trimmed || 'artifact.txt');
  }

  const insideStudioWorkspace = isPathInsideDirectory(
    absPath,
    studioWorkspaceRoot,
  );
  const insideTopWorkspace = isPathInsideDirectory(absPath, topWorkspaceRoot);
  const isInsideWorkspace = insideStudioWorkspace || insideTopWorkspace;

  const workspaceRelativePath = insideStudioWorkspace
    ? path.relative(studioWorkspaceRoot, absPath).replace(/\\/g, '/')
    : insideTopWorkspace
      ? path.relative(topWorkspaceRoot, absPath).replace(/\\/g, '/')
      : absPath.replace(/\\/g, '/');

  return {
    absPath,
    workspaceRelativePath: workspaceRelativePath || 'artifact.txt',
    isInsideWorkspace,
    studioWorkspaceRoot,
    topWorkspaceRoot,
  };
}

/**
 * Executes a command on Command Prompt (`cmd`), PowerShell (`powershell`/`pwsh`), or POSIX shells (`bash`/`sh`/`wsl`).
 */
export async function executeShellCommand(params: {
  command: string;
  shell: TerminalShell;
  cwd: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<ShellExecutionResult> {
  const timeoutMs = Math.min(Math.max(params.timeoutMs ?? 30_000, 1_000), 120_000);
  const startMs = Date.now();

  await fs.mkdir(params.cwd, { recursive: true }).catch(() => {});

  const { executable, args } = buildShellSpawnArgs(params.shell, params.command);

  return new Promise<ShellExecutionResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const child = spawn(executable, args, {
      cwd: params.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env },
    });

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Math.max(1, Date.now() - startMs);
      resolve({
        ok: !timedOut && exitCode === 0,
        shell: params.shell,
        command: params.command,
        cwd: params.cwd,
        exitCode,
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(stderr),
        durationMs,
        timedOut,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // ignore
      }
      finish(null);
    }, timeoutMs);

    if (params.signal) {
      params.signal.addEventListener(
        'abort',
        () => {
          try {
            child.kill();
          } catch {
            // ignore
          }
          finish(null);
        },
        { once: true },
      );
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < 32_000) {
        stdout += chunk.toString('utf8');
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 32_000) {
        stderr += chunk.toString('utf8');
      }
    });

    child.on('error', (err) => {
      stderr += `\nSpawn error (${executable}): ${err.message}`;
      finish(1);
    });

    child.on('close', (code) => {
      finish(code);
    });
  });
}

function buildShellSpawnArgs(
  shell: TerminalShell,
  command: string,
): { executable: string; args: string[] } {
  switch (shell) {
    case 'cmd':
      return {
        executable: 'cmd.exe',
        args: ['/d', '/s', '/c', command],
      };
    case 'pwsh':
      return {
        executable: 'pwsh',
        args: ['-NoProfile', '-NonInteractive', '-Command', command],
      };
    case 'bash':
      return {
        executable: 'bash',
        args: ['-c', command],
      };
    case 'sh':
      return {
        executable: 'sh',
        args: ['-c', command],
      };
    case 'wsl':
      return {
        executable: 'wsl.exe',
        args: ['--', 'bash', '-c', command],
      };
    case 'powershell':
    default:
      return {
        executable: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-Command', command],
      };
  }
}

function truncateOutput(text: string, maxChars = 12_000): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}\n...[output truncated at ${maxChars} chars]`;
}

export function normalizeTerminalApprovalKey(
  shell: TerminalShell,
  command: string,
): string {
  return `${shell}::${command.trim()}`;
}

export function isTerminalCommandApprovedInMeta(
  metadata: Record<string, unknown> | null | undefined,
  shell: TerminalShell,
  command: string,
): boolean {
  if (!metadata) return false;
  const list = metadata['approvedTerminalCommands'];
  if (!Array.isArray(list)) return false;
  const key = normalizeTerminalApprovalKey(shell, command);
  return list.includes(key) || list.includes('*');
}

export function isExternalPathApprovedInMeta(
  metadata: Record<string, unknown> | null | undefined,
  absPath: string,
): boolean {
  if (!metadata) return false;
  const list = metadata['approvedExternalPaths'];
  if (!Array.isArray(list)) return false;
  const norm = path.resolve(absPath).replace(/\\/g, '/').toLowerCase();
  return list.includes(norm) || list.includes('*');
}

export function isDenialResponseText(text: string): boolean {
  const clean = text.trim().toLowerCase();
  return /^(?:deny|denied|no|nope|reject|rejected|cancel|stop|don't|do not)\b/.test(
    clean,
  );
}

/**
 * When a human replies to or resolves a permission request (or replies in the Agent Console),
 * executes the approved terminal command or external file write and returns a formatted summary
 * to append to the conversation so the agent receives the exact command output or file write confirmation.
 */
export async function processPendingPermissionResolution(params: {
  prisma: PrismaService;
  studioId: string;
  taskId: string;
  requestId?: string;
  approved: boolean;
}): Promise<{
  handled: boolean;
  summaryText: string;
}> {
  const task = await params.prisma.task
    ?.findUnique?.({
      where: { id: params.taskId },
      select: { id: true, metadata: true },
    })
    .catch(() => null);

  if (!task) {
    return { handled: false, summaryText: '' };
  }

  const meta: Record<string, unknown> =
    typeof task.metadata === 'object' && task.metadata !== null
      ? { ...(task.metadata as Record<string, unknown>) }
      : {};

  const pendingMap: Record<string, PendingPermissionAction> =
    typeof meta['pendingPermissions'] === 'object' &&
    meta['pendingPermissions'] !== null
      ? {
          ...(meta['pendingPermissions'] as Record<
            string,
            PendingPermissionAction
          >),
        }
      : {};

  // Find target pending permission(s)
  const targetEntries = Object.entries(pendingMap).filter(([id, item]) => {
    if (!item || item.status !== 'PENDING') return false;
    if (params.requestId) return id === params.requestId;
    return true;
  });

  if (targetEntries.length === 0) {
    return { handled: false, summaryText: '' };
  }

  const summaries: string[] = [];
  const approvedTerminalCommands = new Set<string>(
    Array.isArray(meta['approvedTerminalCommands'])
      ? (meta['approvedTerminalCommands'] as string[])
      : [],
  );
  const approvedExternalPaths = new Set<string>(
    Array.isArray(meta['approvedExternalPaths'])
      ? (meta['approvedExternalPaths'] as string[])
      : [],
  );

  for (const [reqId, pending] of targetEntries) {
    if (!params.approved) {
      pendingMap[reqId] = { ...pending, status: 'DENIED' };
      if (pending.type === 'TERMINAL_COMMAND') {
        summaries.push(
          `[PERMISSION DENIED] Terminal command on \`${pending.shell}\` (\`${pending.command}\`) was denied by the operator.`,
        );
      } else {
        summaries.push(
          `[PERMISSION DENIED] Writing file outside /workspace/ (\`${pending.displayPath}\`) was denied by the operator.`,
        );
      }
      continue;
    }

    if (pending.type === 'TERMINAL_COMMAND') {
      if (meta['approvedMainPcControlOnResolve']) {
        meta['approvedMainPcControl'] = true;
        approvedTerminalCommands.add('MAIN_PC_CONTROL');
      }
      approvedTerminalCommands.add(
        normalizeTerminalApprovalKey(pending.shell, pending.command),
      );
      const execRes = await executeShellCommand({
        command: pending.command,
        shell: pending.shell,
        cwd: pending.cwd,
        timeoutMs: pending.timeoutMs,
      });
      pendingMap[reqId] = { ...pending, status: 'EXECUTED' };

      const payloadJson = JSON.stringify({
        ok: execRes.ok,
        permissionApproved: true,
        shell: execRes.shell,
        command: execRes.command,
        cwd: execRes.cwd,
        exitCode: execRes.exitCode,
        durationMs: execRes.durationMs,
        timedOut: execRes.timedOut,
        stdout: execRes.stdout,
        stderr: execRes.stderr,
      });

      summaries.push(
        [
          `[PERMISSION APPROVED — TERMINAL COMMAND EXECUTED]`,
          `Shell: \`${execRes.shell}\` | CWD: \`${execRes.cwd}\` | Exit Code: \`${execRes.exitCode ?? 'timeout'}\` (${execRes.durationMs}ms)`,
          `Command: \`${execRes.command}\``,
          execRes.stdout ? `STDOUT:\n\`\`\`text\n${execRes.stdout}\n\`\`\`` : 'STDOUT: (empty)',
          execRes.stderr ? `STDERR:\n\`\`\`text\n${execRes.stderr}\n\`\`\`` : '',
          `[TOOL_RESULT name="run_terminal_command"]\n${payloadJson}`,
        ]
          .filter(Boolean)
          .join('\n'),
      );
    } else if (pending.type === 'EXTERNAL_FILE_WRITE') {
      const normAbs = path
        .resolve(pending.absPath)
        .replace(/\\/g, '/')
        .toLowerCase();
      approvedExternalPaths.add(normAbs);

      await fs.mkdir(path.dirname(pending.absPath), { recursive: true });
      await fs.writeFile(pending.absPath, pending.content, 'utf8');
      const bytes = Buffer.byteLength(pending.content, 'utf8');

      const artifact = await params.prisma.runArtifact
        .create({
          data: {
            runId: pending.runId,
            path: pending.displayPath,
            language: pending.language,
            content: pending.content,
            bytes,
            agentComment: pending.comment,
          },
          select: { id: true, path: true, bytes: true },
        })
        .catch(() => null);

      if (pending.comment) {
        await params.prisma.workspaceFileComment
          ?.create?.({
            data: {
              studioId: params.studioId,
              filePath: pending.displayPath,
              authorKind: 'AGENT',
              agentId: pending.agentId,
              agentKey: pending.agentKey,
              runId: pending.runId,
              taskId: params.taskId,
              body: pending.comment,
            },
          })
          .catch(() => null);
      }

      pendingMap[reqId] = { ...pending, status: 'EXECUTED' };

      const payloadJson = JSON.stringify({
        ok: true,
        permissionApproved: true,
        artifactId: artifact?.id ?? null,
        path: pending.displayPath,
        diskPath: pending.absPath,
        bytes,
      });

      summaries.push(
        [
          `[PERMISSION APPROVED — EXTERNAL FILE WRITTEN]`,
          `Wrote \`${pending.absPath}\` (${bytes} bytes).`,
          `[TOOL_RESULT name="save_artifact"]\n${payloadJson}`,
        ].join('\n'),
      );
    }
  }

  meta['pendingPermissions'] = pendingMap;
  meta['approvedTerminalCommands'] = Array.from(approvedTerminalCommands);
  meta['approvedExternalPaths'] = Array.from(approvedExternalPaths);

  await params.prisma.task
    .update({
      where: { id: params.taskId },
      data: { metadata: meta as object },
    })
    .catch(() => {});

  return {
    handled: true,
    summaryText: summaries.join('\n\n'),
  };
}
