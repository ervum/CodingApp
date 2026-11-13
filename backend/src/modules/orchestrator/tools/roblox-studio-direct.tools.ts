import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Injectable, Optional } from '@nestjs/common';
import type { ToolArgsOf } from '@robdev/shared';
import { RealtimeService } from '../../realtime/realtime.service.js';
import {
  parseRobloxStudioTargetFromPath,
  syncScriptViaRobloxStudioMcp,
} from '../coding-mode-rules.js';
import {
  getStudioPcAndRobloxConfig,
  logObservationScreenshot,
  requestMainPcPermissionPrompt,
} from './pc-computer-use.tools.js';
import { PcDesktopAutomationService } from './pc-desktop-automation.service.js';
import {
  compileWorkspaceToRbxlx,
  readLatestRobloxStudioDiskLog,
} from './roblox-xml-serializer.js';
import {
  executeShellCommand,
  getWorkspaceRoots,
} from './terminal-and-permissions.helper.js';
import type { ToolContext, ToolHandler, ToolResult } from './tool-context.js';
import {
  collectWorkspaceFileEntries,
  readWorkspaceFileContent,
} from './workspace-files.tools.js';

export async function findRobloxStudioExecutable(): Promise<string | null> {
  const localAppData = process.env['LOCALAPPDATA'] ?? '';
  if (!localAppData) return null;
  const versionsDir = path.join(localAppData, 'Roblox', 'Versions');
  const dirs = await fs.readdir(versionsDir).catch(() => []);
  const candidates: Array<{ exePath: string; mtimeMs: number }> = [];

  for (const dir of dirs) {
    const exePath = path.join(versionsDir, dir, 'RobloxStudioBeta.exe');
    const st = await fs.stat(exePath).catch(() => null);
    if (st && st.isFile()) {
      candidates.push({ exePath, mtimeMs: st.mtimeMs });
    }
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.exePath ?? null;
}

@Injectable()
export class StudioDirectTool implements ToolHandler<'studio_direct'> {
  readonly name = 'studio_direct' as const;

  constructor(
    private readonly pc: PcDesktopAutomationService,
    @Optional() private readonly realtime?: RealtimeService,
  ) {}

  async execute(
    args: ToolArgsOf<'studio_direct'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const cfg = await getStudioPcAndRobloxConfig(ctx);
    const { studioWorkspaceRoot } = getWorkspaceRoots(cfg.studioSlug);
    const buildDir = path.join(studioWorkspaceRoot, 'Build');

    // 1. Read-only actions (`status`, `build_place`, `read_output`) never require Main PC mouse/keyboard permission
    if (args.action === 'status') {
      const studioExe = await findRobloxStudioExecutable();
      const windows = await this.pc.listWindows();
      const studioWindows = windows.filter(
        (w) =>
          w.processName.toLowerCase().includes('robloxstudio') ||
          w.title.toLowerCase().includes('roblox studio'),
      );
      const logInfo = await readLatestRobloxStudioDiskLog();
      return {
        payload: {
          ok: true,
          action: 'status',
          studioExecutable: studioExe,
          isStudioOpen: studioWindows.length > 0,
          openStudioWindows: studioWindows,
          isUserSignedIn: logInfo.isUserSignedIn,
          latestLogFile: logInfo.logFilePath,
          recentErrorCount: logInfo.errors.length,
          recentErrors: logInfo.errors.slice(-10),
          settings: {
            allowPcControlWithoutPermission: cfg.allowPcControlWithoutPermission,
            pcIdleTakeoverSeconds: cfg.pcIdleTakeoverSeconds,
            allowAutoSaveVersion: cfg.allowAutoSaveVersion,
            allowAutoPublish: cfg.allowAutoPublish,
            hasOpenCloudApiKey: Boolean(cfg.openCloudApiKey),
            robloxUniverseId: cfg.robloxUniverseId,
            robloxPlaceId: cfg.robloxPlaceId,
          },
        },
      };
    }

    if (args.action === 'build_place') {
      const compiled = await compileWorkspaceToRbxlx({
        ctx,
        outputDir: buildDir,
        placeFileName: args.placeFile || `${ctx.game?.name || cfg.studioSlug}.rbxlx`,
      });
      await ctx.log.entry(
        'SYSTEM',
        `Compiled ${compiled.scriptCount} workspace Luau script(s) into ${compiled.placeFilePath}`,
      );
      return {
        payload: {
          ok: true,
          action: 'build_place',
          placeFilePath: compiled.placeFilePath,
          modelFilePaths: compiled.modelFilePaths,
          scriptCount: compiled.scriptCount,
          scriptPaths: compiled.scriptPaths,
        },
      };
    }

    if (args.action === 'read_output') {
      const logInfo = await readLatestRobloxStudioDiskLog();
      return {
        payload: {
          ok: true,
          action: 'read_output',
          logFilePath: logInfo.logFilePath,
          isUserSignedIn: logInfo.isUserSignedIn,
          errorCount: logInfo.errors.length,
          errors: logInfo.errors,
          warningCount: logInfo.warnings.length,
          warnings: logInfo.warnings,
          outputs: logInfo.outputs,
        },
      };
    }

    // Check Save / Publish permission overrides if configured in Settings
    if (args.action === 'save' && !cfg.allowAutoSaveVersion) {
      return requestMainPcPermissionPrompt({
        ctx,
        realtime: this.realtime,
        actionSummary: 'Save Roblox Studio place version',
        idleSeconds: 0,
        thresholdSeconds: cfg.pcIdleTakeoverSeconds,
      });
    }
    if (args.action === 'publish' && !cfg.allowAutoPublish) {
      return requestMainPcPermissionPrompt({
        ctx,
        realtime: this.realtime,
        actionSummary: `Publish Roblox experience (${args.publishType})`,
        idleSeconds: 0,
        thresholdSeconds: cfg.pcIdleTakeoverSeconds,
      });
    }

    // For actions that drive the Main PC GUI, evaluate Main PC permission vs >= 60s Idle Auto-Takeover
    if (args.targetEnv === 'MAIN_PC') {
      const access = await this.pc.evaluateMainPcAccess({
        allowPcControlWithoutPermission: cfg.allowPcControlWithoutPermission,
        pcIdleTakeoverSeconds: cfg.pcIdleTakeoverSeconds,
        taskMetadata: ctx.task.metadata,
      });

      if (access.mode === 'BLOCKED_BY_HOTKEY') {
        return {
          payload: {
            ok: false,
            error: 'STOPPED_BY_CTRL_SHIFT_DELETE',
            message: access.reason,
          },
        };
      }

      if (!access.allowed) {
        return requestMainPcPermissionPrompt({
          ctx,
          realtime: this.realtime,
          actionSummary: `Roblox Studio Direct (${args.action})`,
          idleSeconds: access.idleSeconds,
          thresholdSeconds: cfg.pcIdleTakeoverSeconds,
        });
      }
    }

    // 2. `open_place`: Compile .rbxlx and open it in RobloxStudioBeta.exe
    if (args.action === 'open_place') {
      const res = await this.openCompiledPlaceInStudio(ctx, buildDir, args.placeFile);
      if (res.observation) {
        await logObservationScreenshot(ctx, this.name, res.observation);
      }
      return {
        payload: {
          ...res.payload,
          ok: res.ok,
        },
        ...(res.observation?.image ? { images: [res.observation.image] } : {}),
      };
    }

    // 3. `open_experience`: Open a cloud or recent experience by placeId/universeId URI or Studio Start Page GUI search
    if (args.action === 'open_experience') {
      const res = await this.openExperienceInStudio(ctx, cfg.studioSlug, {
        placeId: args.placeId ?? cfg.robloxPlaceId ?? undefined,
        universeId: args.universeId ?? cfg.robloxUniverseId ?? undefined,
        experienceName: args.experienceName ?? ctx.game?.name,
      });
      if (res.observation) {
        await logObservationScreenshot(ctx, this.name, res.observation);
      }
      return {
        payload: {
          ...res.payload,
          ok: res.ok,
        },
        ...(res.observation?.image ? { images: [res.observation.image] } : {}),
      };
    }

    // 4. `manual_create_script`: Create and edit a script manually inside Roblox Studio GUI like a human
    if (args.action === 'manual_create_script') {
      const res = await this.manualGuiCreateOrEditScript(ctx, cfg.studioSlug, {
        scriptPath: args.scriptPath ?? 'ServerScriptService/Main.server.luau',
        scriptContent: args.scriptContent ?? '--!strict\nprint("Hello from RobDev")\n',
      });
      if (res.observation) {
        await logObservationScreenshot(ctx, this.name, res.observation);
      }
      return {
        payload: {
          ...res.payload,
          ok: res.ok,
        },
        ...(res.observation?.image ? { images: [res.observation.image] } : {}),
      };
    }

    // 5. `sync_files`: Sync workspace scripts via any/all methods (.rbxlx, Silicon/Rojo/Azul/Argon, MCP, Open Cloud API, Insert From File, Manual GUI)
    if (args.action === 'sync_files') {
      const syncRes = await this.syncWorkspaceToStudio({
        ctx,
        studioSlug: cfg.studioSlug,
        buildDir,
        method: args.syncMethod,
        openCloudApiKey: cfg.openCloudApiKey,
        universeId: args.universeId ?? cfg.robloxUniverseId,
        placeId: args.placeId ?? cfg.robloxPlaceId,
      });
      if (syncRes.observation) {
        await logObservationScreenshot(ctx, this.name, syncRes.observation);
      }
      return {
        payload: {
          ...syncRes.payload,
          ok: syncRes.ok,
        },
        ...(syncRes.observation?.image
          ? { images: [syncRes.observation.image] }
          : {}),
      };
    }

    // 6. `playtest`: Direct non-MCP playtest in Roblox Studio (F5/F8, gameplay steps, viewport screenshot, disk log tail, Shift+F5)
    if (args.action === 'playtest') {
      const ptRes = await this.runDirectStudioPlaytest({
        ctx,
        studioSlug: cfg.studioSlug,
        playMode: args.playMode,
        playSeconds: args.playSeconds,
        playSteps: args.playSteps,
      });
      if (ptRes.observation) {
        await logObservationScreenshot(ctx, this.name, ptRes.observation);
      }
      return {
        payload: {
          ...ptRes.payload,
          ok: ptRes.ok,
        },
        ...(ptRes.observation?.image
          ? { images: [ptRes.observation.image] }
          : {}),
      };
    }

    // 7. `save`: Save place (`Ctrl+S` in Studio + compile `.rbxlx` + record SAVED build)
    if (args.action === 'save') {
      const compiled = await compileWorkspaceToRbxlx({
        ctx,
        outputDir: buildDir,
      });
      await this.pc.executeMainPcSteps({
        studioId: ctx.studioId,
        studioSlug: cfg.studioSlug,
        prisma: ctx.prisma,
        window: 'Roblox Studio',
        steps: [{ type: 'hotkey', keys: ['Ctrl', 'S'] }],
        observeAfter: true,
        settleMs: 500,
      });
      const recordedVersion = await this.recordGameBuildVersion(
        ctx,
        'SAVED',
        args.notes || `Saved place (${compiled.scriptCount} scripts)`,
      );
      return {
        payload: {
          ok: true,
          action: 'save',
          placeFilePath: compiled.placeFilePath,
          scriptCount: compiled.scriptCount,
          recordedBuildVersion: recordedVersion,
        },
      };
    }

    // 8. `publish`: Publish via Open Cloud Place API AND/OR Roblox Studio GUI (`Alt+P`)
    if (args.action === 'publish') {
      const compiled = await compileWorkspaceToRbxlx({
        ctx,
        outputDir: buildDir,
      });
      const universeId = args.universeId ?? cfg.robloxUniverseId;
      const placeId = args.placeId ?? cfg.robloxPlaceId;

      let openCloudResult: {
        published: boolean;
        versionNumber?: number;
        message: string;
      } | null = null;

      if (cfg.openCloudApiKey && universeId && placeId) {
        openCloudResult = await this.publishPlaceViaOpenCloud({
          apiKey: cfg.openCloudApiKey,
          universeId,
          placeId,
          rbxlxFilePath: compiled.placeFilePath,
          versionType: args.publishType,
        });
      }

      // Also trigger Alt+P in Roblox Studio if open
      const windows = await this.pc.listWindows();
      const studioOpen = windows.some((w) =>
        w.processName.toLowerCase().includes('robloxstudio'),
      );
      if (studioOpen && !openCloudResult?.published) {
        await this.pc.executeMainPcSteps({
          studioId: ctx.studioId,
          studioSlug: cfg.studioSlug,
          prisma: ctx.prisma,
          window: 'Roblox Studio',
          steps: [
            { type: 'hotkey', keys: ['Alt', 'P'] },
            { type: 'wait', ms: 1200 },
          ],
          observeAfter: true,
        });
      }

      const recordedVersion = await this.recordGameBuildVersion(
        ctx,
        args.publishType === 'Published' ? 'PUBLISHED' : 'SAVED',
        args.notes ||
          openCloudResult?.message ||
          `Published place (${compiled.scriptCount} scripts)`,
        openCloudResult?.versionNumber,
      );

      return {
        payload: {
          ok: true,
          action: 'publish',
          publishType: args.publishType,
          placeFilePath: compiled.placeFilePath,
          openCloud: openCloudResult,
          recordedBuildVersion: recordedVersion,
        },
      };
    }

    // 9. `pipeline`: Full end-to-end autonomous pipeline (build_place -> open_place -> sync_files -> playtest -> save)
    const openRes = await this.openCompiledPlaceInStudio(
      ctx,
      buildDir,
      args.placeFile,
    );
    const syncRes = await this.syncWorkspaceToStudio({
      ctx,
      studioSlug: cfg.studioSlug,
      buildDir,
      method: args.syncMethod,
      openCloudApiKey: cfg.openCloudApiKey,
      universeId: args.universeId ?? cfg.robloxUniverseId,
      placeId: args.placeId ?? cfg.robloxPlaceId,
    });
    const playRes = await this.runDirectStudioPlaytest({
      ctx,
      studioSlug: cfg.studioSlug,
      playMode: args.playMode,
      playSeconds: args.playSeconds,
      playSteps: args.playSteps,
    });
    await this.pc.executeMainPcSteps({
      studioId: ctx.studioId,
      studioSlug: cfg.studioSlug,
      prisma: ctx.prisma,
      window: 'Roblox Studio',
      steps: [{ type: 'hotkey', keys: ['Ctrl', 'S'] }],
      observeAfter: false,
    });

    return {
      payload: {
        ok: true,
        action: 'pipeline',
        openStep: openRes.payload,
        syncStep: syncRes.payload,
        playtestStep: playRes.payload,
      },
      ...(playRes.observation?.image
        ? { images: [playRes.observation.image] }
        : {}),
    };
  }

  private async openCompiledPlaceInStudio(
    ctx: ToolContext,
    buildDir: string,
    placeFileName?: string,
  ): Promise<{
    ok: boolean;
    payload: Record<string, unknown>;
    observation?: Awaited<ReturnType<PcDesktopAutomationService['observeMainPc']>>;
  }> {
    const compiled = await compileWorkspaceToRbxlx({
      ctx,
      outputDir: buildDir,
      placeFileName,
    });
    const studioExe = await findRobloxStudioExecutable();
    if (!studioExe) {
      return {
        ok: false,
        payload: {
          action: 'open_place',
          error: 'ROBLOX_STUDIO_NOT_FOUND',
          placeFilePath: compiled.placeFilePath,
          message:
            'RobloxStudioBeta.exe was not found under %LOCALAPPDATA%\\Roblox\\Versions. Built .rbxlx place file on disk.',
        },
      };
    }

    await this.pc.controlWindow({
      action: 'launch',
      match: studioExe,
      args: [compiled.placeFilePath],
    });

    // Wait for Roblox Studio window to appear and load the place
    const deadline = Date.now() + 18_000;
    while (Date.now() < deadline) {
      const wins = await this.pc.listWindows();
      const studioWin = wins.find(
        (w) =>
          w.processName.toLowerCase().includes('robloxstudio') &&
          w.width > 300,
      );
      if (studioWin) {
        await this.pc.controlWindow({
          action: 'maximize',
          match: 'RobloxStudioBeta',
        });
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    await new Promise((r) => setTimeout(r, 2500));
    const cfg = await getStudioPcAndRobloxConfig(ctx);
    const observation = await this.pc.observeMainPc({
      studioId: ctx.studioId,
      studioSlug: cfg.studioSlug,
      prisma: ctx.prisma,
      target: 'RobloxStudioBeta',
      annotate: true,
    });

    return {
      ok: true,
      payload: {
        action: 'open_place',
        studioExecutable: studioExe,
        placeFilePath: compiled.placeFilePath,
        scriptCount: compiled.scriptCount,
        windowTitle: observation.windowTitle,
        screenshotPath: observation.screenshotPath,
        mediaId: observation.mediaId,
      },
      observation,
    };
  }

  private async openExperienceInStudio(
    ctx: ToolContext,
    studioSlug: string,
    params: {
      placeId?: string;
      universeId?: string;
      experienceName?: string;
    },
  ): Promise<{
    ok: boolean;
    payload: Record<string, unknown>;
    observation?: Awaited<ReturnType<PcDesktopAutomationService['observeMainPc']>>;
  }> {
    const studioExe = await findRobloxStudioExecutable();
    if (!studioExe) {
      return {
        ok: false,
        payload: {
          action: 'open_experience',
          error: 'ROBLOX_STUDIO_NOT_FOUND',
          message: 'RobloxStudioBeta.exe was not found on this PC.',
        },
      };
    }

    if (params.placeId) {
      const uri = `roblox-studio:1+launchmode:edit+task:EditPlace+placeId:${params.placeId}${params.universeId ? `+universeId:${params.universeId}` : ''}`;
      await this.pc.controlWindow({ action: 'launch', match: uri });
    } else {
      await this.pc.controlWindow({ action: 'launch', match: studioExe });
    }

    await new Promise((r) => setTimeout(r, 4000));
    await this.pc.controlWindow({ action: 'maximize', match: 'RobloxStudioBeta' });

    if (params.experienceName && !params.placeId) {
      // Search for the experience name on the Studio start screen and press Enter
      await this.pc.executeMainPcSteps({
        studioId: ctx.studioId,
        studioSlug,
        prisma: ctx.prisma,
        window: 'RobloxStudioBeta',
        steps: [
          { type: 'click', target: { text: 'Search', space: 'screenshot' } },
          { type: 'type', text: params.experienceName },
          { type: 'hotkey', keys: ['Enter'] },
          { type: 'wait', ms: 1500 },
        ],
        observeAfter: false,
      });
    }

    const observation = await this.pc.observeMainPc({
      studioId: ctx.studioId,
      studioSlug,
      prisma: ctx.prisma,
      target: 'RobloxStudioBeta',
      annotate: true,
    });

    return {
      ok: true,
      payload: {
        action: 'open_experience',
        placeId: params.placeId ?? null,
        universeId: params.universeId ?? null,
        experienceName: params.experienceName ?? null,
        windowTitle: observation.windowTitle,
        screenshotPath: observation.screenshotPath,
        mediaId: observation.mediaId,
      },
      observation,
    };
  }

  private async syncWorkspaceToStudio(params: {
    ctx: ToolContext;
    studioSlug: string;
    buildDir: string;
    method: ToolArgsOf<'studio_direct'>['syncMethod'];
    openCloudApiKey: string | null;
    universeId: string | null;
    placeId: string | null;
  }): Promise<{
    ok: boolean;
    payload: Record<string, unknown>;
    observation?: Awaited<ReturnType<PcDesktopAutomationService['observeMainPc']>>;
  }> {
    const { ctx, studioSlug, buildDir, method } = params;
    const { studioWorkspaceRoot } = getWorkspaceRoots(studioSlug);
    const compiled = await compileWorkspaceToRbxlx({
      ctx,
      outputDir: buildDir,
    });

    const attemptedMethods: Array<{
      method: string;
      ok: boolean;
      detail: string;
    }> = [];

    // Method A: Roblox Studio MCP (if requested or `auto`)
    if (method === 'mcp' || method === 'auto') {
      const files = await collectWorkspaceFileEntries(ctx, '', 6);
      const luauFiles = files.filter((f) => /\.(?:luau|lua)$/i.test(f.path));
      let syncedCount = 0;
      for (const f of luauFiles.slice(0, 40)) {
        const loaded = await readWorkspaceFileContent(ctx, f.path);
        const target = loaded
          ? parseRobloxStudioTargetFromPath(loaded.resolvedPath)
          : null;
        if (loaded && target) {
          const mcpRes = await syncScriptViaRobloxStudioMcp(
            target,
            loaded.content,
          );
          if (mcpRes.synced) syncedCount += 1;
          else break;
        }
      }
      attemptedMethods.push({
        method: 'mcp',
        ok: syncedCount > 0,
        detail:
          syncedCount > 0
            ? `Synced ${syncedCount} script(s) via Roblox Studio MCP.`
            : 'MCP proxy not active; continuing with non-MCP sync methods.',
      });
      if (method === 'mcp') {
        return {
          ok: syncedCount > 0,
          payload: {
            action: 'sync_files',
            method: 'mcp',
            syncedCount,
            placeFilePath: compiled.placeFilePath,
            attemptedMethods,
          },
        };
      }
    }

    // Method B: Silicon / Rojo / Azul / Argon CLI sync
    if (
      method === 'silicon' ||
      method === 'rojo' ||
      method === 'azul' ||
      method === 'argon' ||
      method === 'auto'
    ) {
      if (method === 'rojo') {
        const rojoRes = await executeShellCommand({
          command: `rojo build -o "${compiled.placeFilePath}"`,
          shell: 'powershell',
          cwd: studioWorkspaceRoot,
          timeoutMs: 15_000,
        });
        attemptedMethods.push({
          method: 'rojo',
          ok: rojoRes.ok,
          detail: rojoRes.ok
            ? `Built place via Rojo CLI (${compiled.placeFilePath})`
            : `Rojo CLI fallback to built-in .rbxlx compiler (${compiled.scriptCount} scripts)`,
        });
      } else {
        const siliconPy = path.resolve('C:/Dev/Silicon/Silicon.py');
        const hasSilicon = await fs
          .access(siliconPy)
          .then(() => true)
          .catch(() => false);
        if (hasSilicon) {
          // Trigger a non-blocking Silicon export/sync pass
          await executeShellCommand({
            command: `Start-Process -WindowStyle Hidden -FilePath "python" -ArgumentList @('"${siliconPy}"', 'ExportSynchronize', '-p', '"${studioWorkspaceRoot}"')`,
            shell: 'powershell',
            cwd: 'C:/Dev/Silicon',
            timeoutMs: 6_000,
          });
          attemptedMethods.push({
            method: 'silicon',
            ok: true,
            detail: `Started Silicon ExportSynchronize targeting ${studioWorkspaceRoot}`,
          });
        }
      }
    }

    // Method C: Open Cloud Place API Upload
    if (
      (method === 'open_cloud_api' || method === 'auto') &&
      params.openCloudApiKey &&
      params.universeId &&
      params.placeId
    ) {
      const cloudRes = await this.publishPlaceViaOpenCloud({
        apiKey: params.openCloudApiKey,
        universeId: params.universeId,
        placeId: params.placeId,
        rbxlxFilePath: compiled.placeFilePath,
        versionType: 'Saved',
      });
      attemptedMethods.push({
        method: 'open_cloud_api',
        ok: cloudRes.published,
        detail: cloudRes.message,
      });
    }

    // Method D: GUI "Insert From File..." (.rbxmx model injection)
    if (method === 'insert_from_file') {
      const firstModelPath = Object.values(compiled.modelFilePaths)[0];
      if (firstModelPath) {
        const actRes = await this.pc.executeMainPcSteps({
          studioId: ctx.studioId,
          studioSlug,
          prisma: ctx.prisma,
          window: 'RobloxStudioBeta',
          steps: [
            { type: 'focus_window', match: 'RobloxStudioBeta' },
            { type: 'hotkey', keys: ['Alt', 'I'] },
            { type: 'wait', ms: 800 },
            { type: 'type', text: firstModelPath },
            { type: 'hotkey', keys: ['Enter'] },
          ],
          observeAfter: true,
        });
        attemptedMethods.push({
          method: 'insert_from_file',
          ok: actRes.ok,
          detail: `Inserted ${firstModelPath} via Studio Insert From File dialog`,
        });
        return {
          ok: true,
          payload: {
            action: 'sync_files',
            method: 'insert_from_file',
            modelFilePaths: compiled.modelFilePaths,
            attemptedMethods,
          },
          observation: actRes.observation,
        };
      }
    }

    // Method E: Manual Human-Style GUI Script Creation & Editing
    if (method === 'manual_gui') {
      const files = await collectWorkspaceFileEntries(ctx, '', 6);
      const firstLuau = files.find((f) => /\.(?:luau|lua)$/i.test(f.path));
      if (firstLuau) {
        const loaded = await readWorkspaceFileContent(ctx, firstLuau.path);
        if (loaded) {
          return this.manualGuiCreateOrEditScript(ctx, studioSlug, {
            scriptPath: loaded.resolvedPath,
            scriptContent: loaded.content,
          });
        }
      }
    }

    // Method F: Direct .rbxlx place build & verification
    attemptedMethods.push({
      method: 'rbxlx',
      ok: true,
      detail: `Compiled ${compiled.scriptCount} script(s) into ${compiled.placeFilePath} and ${Object.keys(compiled.modelFilePaths).length} service .rbxmx bundle(s).`,
    });

    return {
      ok: true,
      payload: {
        action: 'sync_files',
        placeFilePath: compiled.placeFilePath,
        modelFilePaths: compiled.modelFilePaths,
        scriptCount: compiled.scriptCount,
        scriptPaths: compiled.scriptPaths,
        attemptedMethods,
      },
    };
  }

  /**
   * Creates or edits a script inside Roblox Studio manually using GUI / keyboard shortcuts
   * exactly as a human developer would (focusing Studio, opening/inserting the script, pasting code, saving).
   */
  private async manualGuiCreateOrEditScript(
    ctx: ToolContext,
    studioSlug: string,
    params: { scriptPath: string; scriptContent: string },
  ): Promise<{
    ok: boolean;
    payload: Record<string, unknown>;
    observation?: Awaited<ReturnType<PcDesktopAutomationService['observeMainPc']>>;
  }> {
    const target = parseRobloxStudioTargetFromPath(params.scriptPath);
    const scriptName = target?.scriptName ?? path.basename(params.scriptPath, '.luau');

    const actRes = await this.pc.executeMainPcSteps({
      studioId: ctx.studioId,
      studioSlug,
      prisma: ctx.prisma,
      window: 'RobloxStudioBeta',
      steps: [
        { type: 'focus_window', match: 'RobloxStudioBeta' },
        // Use Ctrl+P (Quick Open in Roblox Studio) to jump to the script if it exists
        { type: 'hotkey', keys: ['Ctrl', 'P'] },
        { type: 'wait', ms: 400 },
        { type: 'type', text: scriptName },
        { type: 'wait', ms: 400 },
        { type: 'hotkey', keys: ['Enter'] },
        { type: 'wait', ms: 500 },
        // Select all & paste the new Luau script source code
        { type: 'hotkey', keys: ['Ctrl', 'A'] },
        { type: 'wait', ms: 150 },
        { type: 'type', text: params.scriptContent },
        { type: 'wait', ms: 300 },
        { type: 'hotkey', keys: ['Ctrl', 'S'] },
      ],
      observeAfter: true,
    });

    return {
      ok: actRes.ok,
      payload: {
        action: 'manual_create_script',
        scriptPath: params.scriptPath,
        scriptName,
        completedSteps: actRes.completedSteps,
        screenshotPath: actRes.observation?.screenshotPath,
        mediaId: actRes.observation?.mediaId,
      },
      observation: actRes.observation,
    };
  }

  /**
   * Runs a live Playtest directly inside Roblox Studio without MCP:
   * 1. Focuses Roblox Studio and records current timestamp for log tailing.
   * 2. Presses `F5` (Play) or `F8` (Run).
   * 3. Executes optional gameplay steps (`WASD`, `Space`, `mouse_look`, GUI clicks).
   * 4. Captures a live viewport screenshot during gameplay.
   * 5. Presses `Shift+F5` to stop the playtest.
   * 6. Reads `%LOCALAPPDATA%\Roblox\logs\*_Studio_*_last.log` to return all print/warn/error output!
   */
  private async runDirectStudioPlaytest(params: {
    ctx: ToolContext;
    studioSlug: string;
    playMode: 'play' | 'run' | 'play_here';
    playSeconds: number;
    playSteps: ToolArgsOf<'studio_direct'>['playSteps'];
  }): Promise<{
    ok: boolean;
    payload: Record<string, unknown>;
    observation?: Awaited<ReturnType<PcDesktopAutomationService['observeMainPc']>>;
  }> {
    const startIso = new Date().toISOString();
    const startKey = params.playMode === 'run' ? 'F8' : 'F5';

    // Default gameplay movements if caller didn't pass custom playSteps
    const gameplaySteps =
      params.playSteps && params.playSteps.length > 0
        ? params.playSteps
        : [
            { type: 'wait' as const, ms: 2000 },
            { type: 'key_hold' as const, key: 'W', ms: 800 },
            { type: 'key_hold' as const, key: 'SPACE', ms: 250 },
          ];

    // Start playtest and run gameplay steps
    const duringPlayRes = await this.pc.executeMainPcSteps({
      studioId: params.ctx.studioId,
      studioSlug: params.studioSlug,
      prisma: params.ctx.prisma,
      window: 'RobloxStudioBeta',
      steps: [
        { type: 'focus_window', match: 'RobloxStudioBeta' },
        { type: 'hotkey', keys: [startKey] },
        ...gameplaySteps,
      ],
      observeAfter: true,
      settleMs: Math.min(8_000, Math.max(1_000, params.playSeconds * 500)),
    });

    // Stop playtest (`Shift+F5`)
    await this.pc.executeMainPcSteps({
      studioId: params.ctx.studioId,
      studioSlug: params.studioSlug,
      prisma: params.ctx.prisma,
      window: 'RobloxStudioBeta',
      steps: [{ type: 'hotkey', keys: ['Shift', 'F5'] }],
      observeAfter: false,
      settleMs: 500,
    });

    const logData = await readLatestRobloxStudioDiskLog(startIso);

    return {
      ok: true,
      payload: {
        action: 'playtest',
        playMode: params.playMode,
        playSeconds: params.playSeconds,
        completedSteps: duringPlayRes.completedSteps,
        logFilePath: logData.logFilePath,
        runtimeErrorCount: logData.errors.length,
        runtimeErrors: logData.errors,
        warnings: logData.warnings,
        consoleOutputs: logData.outputs,
        screenshotPath: duringPlayRes.observation?.screenshotPath,
        mediaId: duringPlayRes.observation?.mediaId,
      },
      observation: duringPlayRes.observation,
    };
  }

  private async publishPlaceViaOpenCloud(params: {
    apiKey: string;
    universeId: string;
    placeId: string;
    rbxlxFilePath: string;
    versionType: 'Saved' | 'Published';
  }): Promise<{
    published: boolean;
    versionNumber?: number;
    message: string;
  }> {
    try {
      const xmlBytes = await fs.readFile(params.rbxlxFilePath);
      const url = `https://apis.roblox.com/universes/v1/${encodeURIComponent(params.universeId)}/places/${encodeURIComponent(params.placeId)}/versions?versionType=${params.versionType}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'x-api-key': params.apiKey,
          'Content-Type': 'application/xml',
        },
        body: xmlBytes,
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return {
          published: false,
          message: `Open Cloud Place API returned HTTP ${res.status}: ${errText.slice(0, 200)}`,
        };
      }
      const data = (await res.json()) as { versionNumber?: number };
      return {
        published: true,
        versionNumber: data.versionNumber,
        message: `Uploaded ${params.versionType} version #${data.versionNumber ?? '?'} via Roblox Open Cloud API.`,
      };
    } catch (err) {
      return {
        published: false,
        message: `Open Cloud upload error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private async recordGameBuildVersion(
    ctx: ToolContext,
    kind: 'SAVED' | 'PUBLISHED',
    notes: string,
    explicitVersion?: number,
  ): Promise<number | null> {
    if (!ctx.game) return null;
    try {
      const gameRow = await ctx.prisma.game.findUnique({
        where: { id: ctx.game.id },
        select: { latestSavedVersion: true, latestPublishedVersion: true },
      });
      const nextVersion =
        explicitVersion ??
        Math.max(
          gameRow?.latestSavedVersion ?? 0,
          gameRow?.latestPublishedVersion ?? 0,
        ) + 1;

      await ctx.prisma.gameBuild
        .create({
          data: {
            gameId: ctx.game.id,
            version: nextVersion,
            kind,
            notes,
            recordedByAgentId: ctx.agent.id,
          },
        })
        .catch(() => null);

      await ctx.prisma.game
        .update({
          where: { id: ctx.game.id },
          data: {
            latestSavedVersion: nextVersion,
            ...(kind === 'PUBLISHED'
              ? { latestPublishedVersion: nextVersion }
              : {}),
          },
        })
        .catch(() => null);

      return nextVersion;
    } catch {
      return null;
    }
  }
}
