import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  buildCodingModeContract,
  normalizeArtifactForCodingMode,
} from '../coding-mode-rules.js';
import { SaveArtifactTool } from './save-artifact.tool.js';
import {
  executeShellCommand,
  getWorkspaceRoots,
  processPendingPermissionResolution,
  resolveWorkspaceOrExternalPath,
} from './terminal-and-permissions.helper.js';
import type { ToolContext } from './tool-context.js';
import {
  CommentWorkspaceFileTool,
  RunTerminalCommandTool,
} from './workspace-files.tools.js';

afterAll(async () => {
  const { studioWorkspaceRoot } = getWorkspaceRoots('test-studio');
  await fs.rm(studioWorkspaceRoot, { recursive: true, force: true }).catch(() => {});
});

function createMockToolContext(overrides?: {
  contextMode?: 'ROBLOX' | 'GENERAL';
  allowTerminalWithoutPermission?: boolean;
  allowExternalFilesWithoutPermission?: boolean;
  taskMetadata?: Record<string, unknown> | null;
}): ToolContext {
  const studioConfig = {
    slug: 'test-studio',
    codingMode: 'LOCAL_SYNC',
    codingSyncTool: 'SILICON',
    contextMode: overrides?.contextMode ?? 'GENERAL',
    allowTerminalWithoutPermission:
      overrides?.allowTerminalWithoutPermission ?? false,
    allowExternalFilesWithoutPermission:
      overrides?.allowExternalFilesWithoutPermission ?? false,
  };

  return {
    studioId: 'studio-1',
    run: { id: 'run-1' },
    task: {
      id: 'task-1',
      title: 'Test Task',
      gameId: null,
      metadata: overrides?.taskMetadata ?? null,
    },
    agent: {
      id: 'agent-1',
      key: 'builder',
      displayName: 'Builder',
      tools: [
        'save_artifact',
        'edit_workspace_file',
        'comment_workspace_file',
        'run_terminal_command',
      ],
      imageConnectionId: null,
      imageModelId: null,
    },
    game: null,
    log: {
      entry: vi.fn().mockResolvedValue(undefined),
      appendText: vi.fn(),
      closeText: vi.fn(),
      flushAll: vi.fn(),
    } as unknown as ToolContext['log'],
    prisma: {
      studio: {
        findUnique: vi.fn().mockResolvedValue(studioConfig),
      },
      runArtifact: {
        create: vi.fn().mockImplementation(async ({ data }) => ({
          id: 'art-1',
          path: data.path,
          bytes: data.bytes,
        })),
      },
      workspaceFileComment: {
        create: vi.fn().mockResolvedValue({ id: 'comment-1' }),
      },
      humanRequest: {
        create: vi.fn().mockResolvedValue({
          id: 'req-perm-1',
          studioId: 'studio-1',
          gameId: null,
          taskId: 'task-1',
          runId: 'run-1',
          agentId: 'agent-1',
          kind: 'DECISION',
          status: 'OPEN',
          title: 'Permission Required',
          body: 'Body',
          createdAt: new Date(),
        }),
      },
      task: {
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
      },
      agentMessage: {
        create: vi.fn().mockResolvedValue({ id: 'msg-1' }),
      },
    } as unknown as ToolContext['prisma'],
    userFacingAgentName: 'Builder',
    signal: new AbortController().signal,
  };
}

describe('Context Mode (GENERAL vs ROBLOX)', () => {
  it('returns General Software Engineering contract when contextMode is GENERAL', () => {
    const contract = buildCodingModeContract('LOCAL_SYNC', 'SILICON', 'GENERAL');
    expect(contract).toContain('GENERAL SOFTWARE ENGINEERING');
    expect(contract).not.toContain('UNIFORM INSTANCE FOLDER');
  });

  it('preserves standard project file paths in GENERAL mode without Silicon Game/ transformation', () => {
    const plan = normalizeArtifactForCodingMode({
      path: 'src/utils/math.ts',
      language: 'typescript',
      content: 'export const add = (a: number, b: number) => a + b;',
      codingMode: 'LOCAL_SYNC',
      codingSyncTool: 'SILICON',
      contextMode: 'GENERAL',
    });
    expect(plan.normalizedPath).toBe('src/utils/math.ts');
    expect(plan.companionFiles).toHaveLength(0);
  });
});

describe('/workspace/ vs External File Permission Gate', () => {
  it('identifies paths inside /workspace/ vs outside /workspace/', () => {
    const insideRel = resolveWorkspaceOrExternalPath(
      'src/index.ts',
      'test-studio',
    );
    expect(insideRel.isInsideWorkspace).toBe(true);
    expect(insideRel.workspaceRelativePath).toBe('src/index.ts');

    const insideVirtual = resolveWorkspaceOrExternalPath(
      '/workspace/scripts/build.py',
      'test-studio',
    );
    expect(insideVirtual.isInsideWorkspace).toBe(true);
    expect(insideVirtual.workspaceRelativePath).toBe('scripts/build.py');

    const outsideTraversal = resolveWorkspaceOrExternalPath(
      '../../../outside-secret.txt',
      'test-studio',
    );
    expect(outsideTraversal.isInsideWorkspace).toBe(false);
  });

  it('allows creating files inside /workspace/ without asking for permission and records agent comments', async () => {
    const tool = new SaveArtifactTool();
    const ctx = createMockToolContext({
      contextMode: 'GENERAL',
      allowExternalFilesWithoutPermission: false,
    });

    const res = await tool.execute(
      {
        path: 'src/hello.ts',
        language: 'typescript',
        content: 'export const greeting = "hello";\n',
        comment: 'Initial greeting module',
      },
      ctx,
    );

    expect(res.payload.ok).toBe(true);
    expect(res.control).toBeUndefined();
    expect(res.payload['path']).toBe('src/hello.ts');
    expect(ctx.prisma.workspaceFileComment.create).toHaveBeenCalledTimes(1);
  });

  it('always asks for permission first when writing outside /workspace/ if setting is OFF', async () => {
    const tool = new SaveArtifactTool();
    const ctx = createMockToolContext({
      contextMode: 'GENERAL',
      allowExternalFilesWithoutPermission: false,
    });

    const outsidePath = path.resolve(process.cwd(), '..', 'outside-test.txt');
    const res = await tool.execute(
      {
        path: outsidePath,
        language: 'text',
        content: 'external content',
        comment: 'Trying to write outside workspace',
      },
      ctx,
    );

    expect(res.payload.ok).toBe(false);
    expect(res.payload['status']).toBe('AWAITING_PERMISSION');
    expect(res.control).toBe('await-human');
    expect(ctx.prisma.humanRequest.create).toHaveBeenCalledTimes(1);
  });
});

describe('Terminal Command Execution & Permission Gate (run_terminal_command)', () => {
  it('always asks for permission before executing a terminal command when allowTerminalWithoutPermission is false', async () => {
    const tool = new RunTerminalCommandTool();
    const ctx = createMockToolContext({
      allowTerminalWithoutPermission: false,
    });

    const res = await tool.execute(
      {
        command: 'echo hello',
        shell: 'cmd',
        timeoutMs: 10000,
        reason: 'Verify environment',
      },
      ctx,
    );

    expect(res.payload.ok).toBe(false);
    expect(res.payload['status']).toBe('AWAITING_PERMISSION');
    expect(res.control).toBe('await-human');
    expect(ctx.prisma.humanRequest.create).toHaveBeenCalledTimes(1);
  });

  it('executes terminal commands on Command Prompt and PowerShell immediately when allowTerminalWithoutPermission is true', async () => {
    const tool = new RunTerminalCommandTool();
    const ctx = createMockToolContext({
      allowTerminalWithoutPermission: true,
    });

    const cmdRes = await tool.execute(
      {
        command: 'echo ROBDEV_CMD_OK',
        shell: 'cmd',
        timeoutMs: 10000,
      },
      ctx,
    );
    expect(cmdRes.payload.ok).toBe(true);
    expect(String(cmdRes.payload['stdout'])).toContain('ROBDEV_CMD_OK');

    const psRes = await executeShellCommand({
      command: 'Write-Output "ROBDEV_PS_OK"',
      shell: 'powershell',
      cwd: process.cwd(),
      timeoutMs: 10000,
    });
    expect(psRes.ok).toBe(true);
    expect(psRes.stdout).toContain('ROBDEV_PS_OK');
  });

  it('executes a pending terminal command when approved by the operator', async () => {
    const tool = new RunTerminalCommandTool();
    const ctx = createMockToolContext({
      allowTerminalWithoutPermission: false,
    });

    const askRes = await tool.execute(
      {
        command: 'echo APPROVED_RUN_OK',
        shell: 'cmd',
        timeoutMs: 10000,
      },
      ctx,
    );
    expect(askRes.control).toBe('await-human');

    // Mock task.findUnique to return the stored pendingPermissions metadata
    vi.mocked(ctx.prisma.task.findUnique).mockResolvedValue({
      id: 'task-1',
      metadata: ctx.task.metadata,
    } as never);

    const resolution = await processPendingPermissionResolution({
      prisma: ctx.prisma,
      studioId: 'studio-1',
      taskId: 'task-1',
      requestId: 'req-perm-1',
      approved: true,
    });

    expect(resolution.handled).toBe(true);
    expect(resolution.summaryText).toContain('PERMISSION APPROVED');
    expect(resolution.summaryText).toContain('APPROVED_RUN_OK');
  });

  it('supports adding standalone agent file comments via comment_workspace_file', async () => {
    const tool = new CommentWorkspaceFileTool();
    const ctx = createMockToolContext();

    const res = await tool.execute(
      {
        path: 'src/index.ts',
        comment: 'Main application entrypoint',
        lineStart: 1,
        lineEnd: 15,
      },
      ctx,
    );

    expect(res.payload.ok).toBe(true);
    expect(res.payload['path']).toBe('src/index.ts');
    expect(ctx.prisma.workspaceFileComment.create).toHaveBeenCalledTimes(1);
  });
});
