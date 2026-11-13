import { Injectable } from '@nestjs/common';
import type { ToolArgsOf } from '@robdev/shared';
import {
  analyzeLuauCode,
  callRobloxStudioMcpTool,
  parseRobloxStudioTargetFromPath,
} from '../coding-mode-rules.js';
import type { ToolContext, ToolHandler, ToolResult } from './tool-context.js';
import {
  collectWorkspaceFileEntries,
  readWorkspaceFileContent,
} from './workspace-files.tools.js';

@Injectable()
export class StudioInspectTreeTool
  implements ToolHandler<'studio_inspect_tree'>
{
  readonly name = 'studio_inspect_tree' as const;

  async execute(
    args: ToolArgsOf<'studio_inspect_tree'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const cleanRoot = args.rootPath
      .replace(/^game\.?/i, '')
      .replace(/\\/g, '/')
      .replace(/\./g, '/')
      .split('/')
      .filter(Boolean);

    const luauInspectCode = `
local HttpService = game:GetService("HttpService")
local segments = ${JSON.stringify(cleanRoot)}
local maxDepth = ${args.maxDepth}

local current = game
for _, seg in ipairs(segments) do
  local nextInst = nil
  if current == game then
    local ok, svc = pcall(function() return game:GetService(seg) end)
    if ok and svc then nextInst = svc end
  end
  if not nextInst then
    nextInst = current:FindFirstChild(seg)
  end
  if not nextInst then
    return HttpService:JSONEncode({ found = false, missingSegment = seg })
  end
  current = nextInst
end

local visited = 0
local function serialize(inst, depth)
  visited += 1
  local node = {
    name = inst.Name,
    className = inst.ClassName,
  }
  if depth < maxDepth and visited < 250 then
    local children = inst:GetChildren()
    if #children > 0 then
      node.children = {}
      for _, child in ipairs(children) do
        if visited >= 250 then break end
        table.insert(node.children, serialize(child, depth + 1))
      end
    end
  end
  return node
end

return HttpService:JSONEncode({
  found = true,
  fullName = current:GetFullName(),
  tree = serialize(current, 0),
})
`.trim();

    const mcpRes = await callRobloxStudioMcpTool('execute_luau', {
      datamodel_type: 'Edit',
      code: luauInspectCode,
    });

    if (mcpRes.ok && mcpRes.output) {
      try {
        const parsed = JSON.parse(mcpRes.output) as Record<string, unknown>;
        return {
          payload: {
            ok: true,
            source: 'roblox-studio-mcp',
            studioId: mcpRes.studioId,
            ...parsed,
          },
        };
      } catch {
        // Fallback if output wasn't strict JSON
      }
    }

    // Fallback to local Silicon Game/ / workspace tree
    const subDir = cleanRoot.length > 0 ? `Game/${cleanRoot.join('/')}` : '';
    const entries = await collectWorkspaceFileEntries(
      ctx,
      subDir,
      args.maxDepth + 1,
    );

    return {
      payload: {
        ok: true,
        source: 'local-workspace-fallback',
        mcpNote: mcpRes.output,
        rootPath: args.rootPath,
        totalEntries: entries.length,
        entries: entries.slice(0, 150),
      },
    };
  }
}

@Injectable()
export class StudioReadScriptTool
  implements ToolHandler<'studio_read_script'>
{
  readonly name = 'studio_read_script' as const;

  async execute(
    args: ToolArgsOf<'studio_read_script'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const target = parseRobloxStudioTargetFromPath(
      args.path.endsWith('.luau') || args.path.endsWith('.lua')
        ? args.path
        : `${args.path}.luau`,
    );

    if (target) {
      const segments = [target.service, ...target.folderSegments, target.scriptName];
      const luauReadCode = `
local HttpService = game:GetService("HttpService")
local segments = ${JSON.stringify(segments)}
local current = game
for i, seg in ipairs(segments) do
  local nextInst = nil
  if i == 1 then
    local ok, svc = pcall(function() return game:GetService(seg) end)
    if ok and svc then nextInst = svc end
  end
  if not nextInst then
    nextInst = current:FindFirstChild(seg)
  end
  if not nextInst then
    return HttpService:JSONEncode({ found = false, missing = seg })
  end
  current = nextInst
end
if not current:IsA("LuaSourceContainer") then
  return HttpService:JSONEncode({ found = false, error = "Not a LuaSourceContainer: " .. current.ClassName })
end
return HttpService:JSONEncode({
  found = true,
  fullName = current:GetFullName(),
  className = current.ClassName,
  source = current.Source,
})
`.trim();

      const mcpRes = await callRobloxStudioMcpTool('execute_luau', {
        datamodel_type: 'Edit',
        code: luauReadCode,
      });

      if (mcpRes.ok && mcpRes.output) {
        try {
          const parsed = JSON.parse(mcpRes.output) as {
            found?: boolean;
            fullName?: string;
            className?: string;
            source?: string;
          };
          if (parsed.found && typeof parsed.source === 'string') {
            const allLines = parsed.source.split(/\r?\n/);
            const startLine = Math.max(1, args.startLine ?? 1);
            const requestedEnd = args.endLine ?? startLine + 649;
            const endLine = Math.min(
              allLines.length,
              Math.min(requestedEnd, startLine + 749),
            );
            const numbered = allLines
              .slice(startLine - 1, endLine)
              .map((l, idx) => `${startLine + idx}: ${l}`)
              .join('\n');

            return {
              payload: {
                ok: true,
                source: 'roblox-studio-mcp',
                fullName: parsed.fullName,
                className: parsed.className,
                totalLines: allLines.length,
                startLine,
                endLine,
                ...(endLine < allLines.length
                  ? { hasMore: true, nextStartLine: endLine + 1 }
                  : {}),
                contentWithLineNumbers: numbered,
              },
            };
          }
        } catch {
          // fall through to local workspace read
        }
      }
    }

    // Fallback to reading from local workspace / Silicon Game/
    const localFile = await readWorkspaceFileContent(ctx, args.path);
    if (!localFile) {
      return {
        payload: {
          ok: false,
          error: 'SCRIPT_NOT_FOUND',
          message: `Script "${args.path}" was not found in Roblox Studio or local workspace.`,
        },
      };
    }

    const allLines = localFile.content.split(/\r?\n/);
    const startLine = Math.max(1, args.startLine ?? 1);
    const requestedEnd = args.endLine ?? startLine + 649;
    const endLine = Math.min(
      allLines.length,
      Math.min(requestedEnd, startLine + 749),
    );
    const numbered = allLines
      .slice(startLine - 1, endLine)
      .map((l, idx) => `${startLine + idx}: ${l}`)
      .join('\n');

    return {
      payload: {
        ok: true,
        source: localFile.sourceRoot,
        path: localFile.resolvedPath,
        totalLines: allLines.length,
        startLine,
        endLine,
        ...(endLine < allLines.length
          ? { hasMore: true, nextStartLine: endLine + 1 }
          : {}),
        contentWithLineNumbers: numbered,
      },
    };
  }
}

@Injectable()
export class StudioRunDiagnosticsTool
  implements ToolHandler<'studio_run_diagnostics'>
{
  readonly name = 'studio_run_diagnostics' as const;

  async execute(
    args: ToolArgsOf<'studio_run_diagnostics'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    let targetCode = args.code ?? '';
    let targetPath = args.path ?? 'inline.luau';

    if (!targetCode && args.path) {
      const localFile = await readWorkspaceFileContent(ctx, args.path);
      if (localFile) {
        targetCode = localFile.content;
        targetPath = localFile.resolvedPath;
      }
    }

    const staticDiagnostics = targetCode
      ? analyzeLuauCode(targetCode, targetPath)
      : { valid: true, issues: [] };

    let consoleLogs: string | undefined;
    if (args.includeConsoleLogs) {
      const consoleRes = await callRobloxStudioMcpTool(
        'get_console_output',
        {},
      );
      if (consoleRes.ok && consoleRes.output) {
        consoleLogs = consoleRes.output.slice(-4000);
      }
    }

    return {
      payload: {
        ok: true,
        path: targetPath,
        valid: staticDiagnostics.valid,
        issueCount: staticDiagnostics.issues.length,
        issues: staticDiagnostics.issues,
        ...(consoleLogs ? { studioConsoleOutput: consoleLogs } : {}),
      },
    };
  }
}

@Injectable()
export class StudioRunPlaytestTool
  implements ToolHandler<'studio_run_playtest'>
{
  readonly name = 'studio_run_playtest' as const;

  async execute(
    args: ToolArgsOf<'studio_run_playtest'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const startRes = await callRobloxStudioMcpTool('start_stop_play', {
      mode: args.mode,
    });

    if (!startRes.ok) {
      // Fallback: run static Luau diagnostics across all workspace Luau files when Studio MCP isn't open
      const files = await collectWorkspaceFileEntries(ctx, '', 6);
      const luauFiles = files.filter((f) => /\.(?:luau|lua)$/i.test(f.path));
      const fileDiagnostics: Array<{
        path: string;
        valid: boolean;
        issues: Array<{ severity: string; line?: number; message: string }>;
      }> = [];

      for (const f of luauFiles.slice(0, 30)) {
        const content = await readWorkspaceFileContent(ctx, f.path);
        if (!content) continue;
        const diag = analyzeLuauCode(content.content, content.resolvedPath);
        if (diag.issues.length > 0) {
          fileDiagnostics.push({
            path: content.resolvedPath,
            valid: diag.valid,
            issues: diag.issues,
          });
        }
      }

      return {
        payload: {
          ok: true,
          mode: 'static-workspace-verification-fallback',
          mcpMessage: startRes.output,
          checkedFilesCount: luauFiles.length,
          filesWithIssuesCount: fileDiagnostics.length,
          fileDiagnostics,
        },
      };
    }

    const waitMs = Math.min(15_000, Math.max(2_000, args.durationSeconds * 1000));
    await new Promise((r) => setTimeout(r, waitMs));

    const consoleRes = await callRobloxStudioMcpTool('get_console_output', {});
    await callRobloxStudioMcpTool('start_stop_play', { mode: 'stop' });

    const consoleOutput = consoleRes.output.slice(-6000);
    const runtimeErrors = consoleOutput
      .split(/\r?\n/)
      .filter((line) => /\b(?:error|exception|stack\s*begin|attempt\s+to\s+)/i.test(line));

    return {
      payload: {
        ok: true,
        mode: args.mode,
        durationSeconds: args.durationSeconds,
        studioId: startRes.studioId,
        runtimeErrorCount: runtimeErrors.length,
        runtimeErrors,
        consoleOutput,
      },
    };
  }
}
