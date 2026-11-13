import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Injectable, Optional } from '@nestjs/common';
import type {
  CodingMode,
  CodingSyncTool,
  ContextMode,
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
  isExternalPathApprovedInMeta,
  resolveWorkspaceOrExternalPath,
  type PendingPermissionAction,
} from './terminal-and-permissions.helper.js';
import type { ToolContext, ToolHandler, ToolResult } from './tool-context.js';

@Injectable()
export class SaveArtifactTool implements ToolHandler<'save_artifact'> {
  readonly name = 'save_artifact' as const;

  constructor(@Optional() private readonly realtime?: RealtimeService) {}

  async execute(
    args: ToolArgsOf<'save_artifact'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const bytes = Buffer.byteLength(args.content, 'utf8');

    const studio = await ctx.prisma.studio
      ?.findUnique?.({
        where: { id: ctx.studioId },
        select: {
          slug: true,
          codingMode: true,
          codingSyncTool: true,
          contextMode: true,
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
    const allowExternalWithoutPerm =
      studio?.allowExternalFilesWithoutPermission ?? false;

    const targetCheck = resolveWorkspaceOrExternalPath(args.path, studioSlug);

    // If path is OUTSIDE /workspace/, enforce permission gate unless allowed in Settings or already approved
    if (!targetCheck.isInsideWorkspace) {
      const alreadyApproved = isExternalPathApprovedInMeta(
        ctx.task.metadata,
        targetCheck.absPath,
      );
      if (!allowExternalWithoutPerm && !alreadyApproved) {
        return this.requestExternalFilePermission(
          args,
          ctx,
          targetCheck.absPath,
          bytes,
        );
      }

      // Allowed to write outside /workspace/
      await fs.mkdir(path.dirname(targetCheck.absPath), { recursive: true });
      await fs.writeFile(targetCheck.absPath, args.content, 'utf8');

      const artifact = await ctx.prisma.runArtifact.create({
        data: {
          runId: ctx.run.id,
          path: targetCheck.workspaceRelativePath,
          language: args.language,
          content: args.content,
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

      await ctx.log.entry(
        'SYSTEM',
        `Created external file: ${targetCheck.absPath} (${bytes} bytes)`,
        {
          createdArtifact: {
            kind: 'artifact',
            id: artifact.id,
            path: artifact.path,
            language: args.language,
            content: args.content.slice(0, 12000),
            bytes,
            agentComment: args.comment ?? null,
          },
        },
      );

      return {
        payload: {
          ok: true,
          artifactId: artifact.id,
          path: artifact.path,
          diskPath: targetCheck.absPath,
          bytes: artifact.bytes,
          outsideWorkspace: true,
        },
      };
    }

    const plan = normalizeArtifactForCodingMode({
      path: targetCheck.workspaceRelativePath,
      language: args.language,
      content: args.content,
      codingMode,
      codingSyncTool,
      contextMode,
    });
    const effectivePath = plan.normalizedPath;

    const artifact = await ctx.prisma.runArtifact.create({
      data: {
        runId: ctx.run.id,
        path: effectivePath,
        language: args.language,
        content: args.content,
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

    const workspaceRoot = targetCheck.studioWorkspaceRoot;
    const sanitizedRel = effectivePath
      .replace(/\\/g, '/')
      .split('/')
      .filter((seg) => seg.length > 0 && seg !== '.' && seg !== '..')
      .join(path.sep);
    const diskPath = path.resolve(
      workspaceRoot,
      sanitizedRel || 'artifact.txt',
    );

    const writtenCompanions: string[] = [];

    if (diskPath.startsWith(workspaceRoot)) {
      await fs.mkdir(path.dirname(diskPath), { recursive: true });
      await fs.writeFile(diskPath, args.content, 'utf8');

      for (const comp of plan.companionFiles) {
        const compRel = comp.relativePath
          .replace(/\\/g, '/')
          .split('/')
          .filter((seg) => seg.length > 0 && seg !== '.' && seg !== '..')
          .join(path.sep);
        const compDiskPath = path.resolve(workspaceRoot, compRel);
        if (!compDiskPath.startsWith(workspaceRoot)) continue;

        await fs.mkdir(path.dirname(compDiskPath), { recursive: true });
        if (!comp.overwriteIfExisting) {
          const exists = await fs
            .access(compDiskPath)
            .then(() => true)
            .catch(() => false);
          if (exists) continue;
        }
        await fs.writeFile(compDiskPath, comp.content, 'utf8');
        writtenCompanions.push(comp.relativePath);
      }
    }

    let robloxMcpStatus:
      | { synced: boolean; studioId?: string; message: string }
      | undefined;

    if (contextMode === 'ROBLOX' && codingMode === 'ROBLOX_MCP') {
      const mcpTarget = parseRobloxStudioTargetFromPath(args.path);
      if (mcpTarget) {
        robloxMcpStatus = await syncScriptViaRobloxStudioMcp(
          mcpTarget,
          args.content,
        );
      }
    }

    const isLuau =
      contextMode === 'ROBLOX' &&
      (args.language === 'luau' ||
        args.language === 'lua' ||
        /\.(?:luau|lua)$/i.test(effectivePath));
    const luauDiagnostics = isLuau
      ? analyzeLuauCode(args.content, effectivePath)
      : undefined;

    const logSuffix =
      robloxMcpStatus
        ? ` — ${robloxMcpStatus.message}`
        : writtenCompanions.length > 0
          ? ` (+ ${writtenCompanions.length} Silicon Properties.yaml files)`
          : '';

    await ctx.log.entry(
      'SYSTEM',
      `Created file artifact: ${effectivePath} (${bytes} bytes)${logSuffix}`,
      {
        createdArtifact: {
          kind: 'artifact',
          id: artifact.id,
          path: effectivePath,
          language: args.language,
          content: args.content.slice(0, 12000),
          bytes,
          agentComment: args.comment ?? null,
        },
        ...(writtenCompanions.length > 0 ? { writtenCompanions } : {}),
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
        path: artifact.path,
        diskPath,
        bytes: artifact.bytes,
        ...(args.comment ? { agentComment: args.comment } : {}),
        ...(writtenCompanions.length > 0 ? { writtenCompanions } : {}),
        ...(robloxMcpStatus ? { robloxMcp: robloxMcpStatus } : {}),
        ...(luauDiagnostics
          ? {
              luauDiagnostics,
              ...(luauDiagnostics.issues.length > 0
                ? {
                    verificationNotice:
                      'Diagnostics found issues in this Luau script. Review `luauDiagnostics.issues` and fix any errors using `edit_workspace_file` or `save_artifact` before concluding.',
                  }
                : {}),
            }
          : {}),
      },
    };
  }

  private async requestExternalFilePermission(
    args: ToolArgsOf<'save_artifact'>,
    ctx: ToolContext,
    absPath: string,
    bytes: number,
  ): Promise<ToolResult> {
    const title = `Permission Required: Write file outside /workspace/`;
    const body = [
      `**${ctx.userFacingAgentName}** is requesting permission to create/write a file **outside** the \`/workspace/\` directory:`,
      `- **Target Path**: \`${absPath}\``,
      `- **Language**: \`${args.language}\` (${bytes} bytes)`,
      args.comment ? `- **Agent Note**: ${args.comment}` : '',
      '',
      'Approve to write this file to disk and continue, or deny to block the external write.',
    ]
      .filter(Boolean)
      .join('\n');

    const options = [
      {
        id: 'approve',
        label: 'Approve External File Write',
        description: `Allow writing ${absPath} and continue`,
      },
      {
        id: 'deny',
        label: 'Deny Write',
        description: 'Do not write outside /workspace/',
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

    const requestId = reqRow?.id ?? `perm_ext_${Date.now()}`;

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
      language: args.language,
      content: args.content,
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
          body: `**[PERMISSION REQUIRED: EXTERNAL FILE WRITE]**\n${body}`,
        },
      })
      .catch(() => null);

    await ctx.log.entry(
      'SYSTEM',
      `Permission requested to write file outside /workspace/: ${absPath} (req ${requestId})`,
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
          'Writing files outside /workspace/ requires human permission. Paused run until the operator approves or denies the request.',
      },
      control: 'await-human',
    };
  }
}
