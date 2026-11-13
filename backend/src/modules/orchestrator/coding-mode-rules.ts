import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { CodingMode, CodingSyncTool, ContextMode } from '@robdev/shared';

const ROBLOX_SERVICES = new Set<string>([
  'Workspace',
  'Players',
  'Lighting',
  'MaterialService',
  'ReplicatedFirst',
  'ReplicatedStorage',
  'ServerScriptService',
  'ServerStorage',
  'StarterGui',
  'StarterPack',
  'StarterPlayer',
  'StarterPlayerScripts',
  'StarterCharacterScripts',
  'SoundService',
  'Chat',
  'TextChatService',
  'Teams',
]);

export interface CompanionFileSpec {
  relativePath: string;
  content: string;
  overwriteIfExisting: boolean;
}

export interface NormalizedArtifactPlan {
  normalizedPath: string;
  companionFiles: CompanionFileSpec[];
}

export interface RobloxMcpScriptTarget {
  service: string;
  folderSegments: string[];
  scriptName: string;
  className: 'Script' | 'LocalScript' | 'ModuleScript';
  dotPath: string;
}

export function sanitizeSiliconInstanceName(raw: string): string {
  const cleaned = raw.replace(/[\\/:*?"<>|]/g, '_').trim();
  return cleaned || 'Instance';
}

export function buildSiliconPropertiesYaml(
  className: string,
  extraProps: Record<string, string | number | boolean> = {},
): string {
  const propLines = ['  Archivable: true'];
  for (const [k, v] of Object.entries(extraProps)) {
    if (k === 'Name' || k === 'Parent' || k === 'Source' || k === 'Archivable') {
      continue;
    }
    propLines.push(`  ${k}: ${JSON.stringify(v)}`);
  }
  return [
    `ClassName: ${className}`,
    'Properties:',
    ...propLines,
    'Attributes: []',
    'Tags: []',
    '',
  ].join('\n');
}

/**
 * Builds the authoritative Coding Mode instructions injected into every agent's system prompt.
 */
export function buildCodingModeContract(
  codingMode: CodingMode = 'LOCAL_SYNC',
  codingSyncTool: CodingSyncTool = 'SILICON',
  contextMode: ContextMode = 'ROBLOX',
): string {
  if (contextMode === 'GENERAL') {
    return `CONTEXT MODE — GENERAL SOFTWARE ENGINEERING (ROBLOX MODE DEACTIVATED)
- You are operating in **General** mode (non-Roblox). Do NOT assume Roblox, Luau, DataModel services, or Silicon folder conventions unless the user explicitly asks for them.
- Write clean, idiomatic, production-ready code in whatever language, framework, or stack fits the user's request (TypeScript, JavaScript, Python, Node.js, HTML/CSS, Rust, Go, C#, C++, SQL, JSON/YAML, Markdown, shell scripts, etc.).
- Persist new files with \`save_artifact\` and update existing files with \`edit_workspace_file\`.
- Always pass a concise, informative \`comment\` parameter on \`save_artifact\` or \`edit_workspace_file\` (or call \`comment_workspace_file\`) explaining the purpose of the file or what changed in this revision so the user can inspect your notes in the Workspace Explorer.
- Organize files naturally inside \`/workspace/\` using standard project relative paths (e.g. \`src/index.ts\`, \`package.json\`, \`README.md\`, \`scripts/build.py\`).`;
  }

  if (codingMode === 'ROBLOX_MCP') {
    return `CODING MODE — DIRECT ROBLOX STUDIO MCP (ROBLOX_MCP)
- You are operating in Direct Roblox Studio MCP mode.
- Every Luau script you persist via \`save_artifact\` is automatically pushed directly into the open Roblox Studio place via the Roblox Studio MCP bridge (\`multi_edit\` / \`execute_luau\` on the \`Edit\` DataModel).
- Use canonical Roblox DataModel paths when calling \`save_artifact\`:
  - Server scripts (\`Script\`): \`ServerScriptService/<Folder>/<ScriptName>.server.luau\`
  - Client scripts (\`LocalScript\`): \`StarterPlayer/StarterPlayerScripts/<Folder>/<ScriptName>.client.luau\` or \`StarterGui/<ScreenGui>/<ScriptName>.client.luau\`
  - Shared/Server modules (\`ModuleScript\`): \`ReplicatedStorage/<Folder>/<ModuleName>.luau\` or \`ServerStorage/<Folder>/<ModuleName>.luau\`
- Intermediate container \`Folder\` instances along the path are created automatically in Roblox Studio.`;
  }

  switch (codingSyncTool) {
    case 'SILICON':
      return `CODING MODE — LOCAL SYNCHRONIZATION: SILICON (UNIFORM INSTANCE FOLDER ARCHITECTURE)
- You are operating in Local Synchronization mode targeting **Silicon**.
- Inside the \`Game/\` folder, Silicon implements a **Uniform Instance Folder** architecture where every Roblox Instance maps 1:1 to a directory on disk, decoupling metadata/properties from pure Luau source code:
  1. **Every Roblox Instance is a Folder**:
     - Services (\`ReplicatedStorage\`, \`ServerScriptService\`, \`StarterPlayer\`, \`StarterPlayerScripts\`, \`StarterGui\`, \`Workspace\`), container \`Folder\`s, and executable scripts (\`ModuleScript\`, \`LocalScript\`, \`Script\`) are each represented as a directory matching their sanitized instance name (\`\\ / : * ? " < > |\` forbidden).
     - Child instances are subdirectories inside their parent instance's folder (e.g., \`Game/StarterPlayer/StarterPlayerScripts/CombatClient/\`).
     - If sibling instances share the same name, append a padded index (\`{OriginalName}-01\`).
  2. **Files Inside Each Instance Folder**:
     - **\`Properties.yaml\`** (metadata, \`ClassName\`, \`Properties\`, \`Attributes\`, \`Tags\`; never include \`Name\`, \`Parent\`, or \`Source\`):
       \`\`\`yaml
       ClassName: ModuleScript
       Properties:
         Archivable: true
       Attributes: []
       Tags: []
       \`\`\`
     - **\`Source.[context].luau\`** (clean, pure Luau source code for \`LuaSourceContainer\` instances):
       - \`Source.shared.luau\` → \`ModuleScript\` (Shared module requireable by both Client & Server)
       - \`Source.client.luau\` → \`LocalScript\` or \`Script\` with \`RunContext = Client\`
       - \`Source.server.luau\` → \`Script\` or \`Script\` with \`RunContext = Server\`
  3. **Example Silicon Layout**:
     \`\`\`text
     Game/
     └── StarterPlayer/
         ├── Properties.yaml
         └── StarterPlayerScripts/
             ├── Properties.yaml
             └── CombatClient/
                 ├── Properties.yaml       <-- ClassName: LocalScript
                 └── Source.client.luau    <-- Pure Luau source code
     \`\`\`
  4. **How to Call \`save_artifact\`**:
     - Always save scripts using their full Silicon path: \`Game/<Service>/<ParentFolders...>/<ScriptInstanceName>/Source.<shared|client|server>.luau\` (\`language: "luau"\`).
     - Save companion \`Properties.yaml\` files (\`language: "yaml"\`) at \`Game/<Service>/<ParentFolders...>/<InstanceName>/Properties.yaml\`.
     - Never write into Silicon internal paths (\`ReplicatedStorage/Silicon/Plugin\`, \`APIService\`, \`ReplicatedStorage/Silicon/Recycle Bin\`) or transient runtime services (\`CoreGui\`, \`PlayerGui\`, \`PlayerScripts\`, \`Camera\`, \`Terrain\`).`;

    case 'ROJO':
      return `CODING MODE — LOCAL SYNCHRONIZATION: ROJO ARCHITECTURE
- You are operating in Local Synchronization mode targeting **Rojo** (\`default.project.json\`).
- Follow Rojo's standard filesystem conventions when calling \`save_artifact\`:
  - \`default.project.json\` maps \`src/shared\` → \`ReplicatedStorage.Shared\`, \`src/server\` → \`ServerScriptService.Server\`, \`src/client\` → \`StarterPlayer.StarterPlayerScripts.Client\`.
  - Server scripts: \`src/server/<Name>.server.luau\` (or \`src/server/<Folder>/init.server.luau\`)
  - Client scripts: \`src/client/<Name>.client.luau\` (or \`src/client/<Folder>/init.client.luau\`)
  - ModuleScripts: \`src/shared/<Name>.luau\` (or \`src/shared/<Folder>/init.luau\`)
  - Instance metadata: \`<Name>.meta.json\` or \`<Name>.model.json\`.`;

    case 'AZUL':
      return `CODING MODE — LOCAL SYNCHRONIZATION: AZUL ARCHITECTURE
- You are operating in Local Synchronization mode targeting **Azul**.
- Follow Azul's project hierarchy when calling \`save_artifact\`:
  - Root config at \`azul.toml\` or \`sync.json\`.
  - Service directories mirror Roblox DataModel services (\`ReplicatedStorage/\`, \`ServerScriptService/\`, \`StarterPlayer/StarterPlayerScripts/\`, \`StarterGui/\`).
  - Scripts use \`.server.luau\`, \`.client.luau\`, and \`.luau\` extensions, with optional \`.azul.json\` metadata files for non-script properties, attributes, and tags.`;

    case 'ARGON':
      return `CODING MODE — LOCAL SYNCHRONIZATION: ARGON ARCHITECTURE
- You are operating in Local Synchronization mode targeting **Argon** (\`default.project.json\`).
- Follow Argon's filesystem conventions when calling \`save_artifact\`:
  - \`src/server/<Name>.server.luau\`, \`src/client/<Name>.client.luau\`, \`src/shared/<Name>.luau\`, and \`init.luau\` / \`init.server.luau\` / \`init.client.luau\` for directory scripts.
  - Instance properties, attributes, and tags go in \`<Name>.data.json\` (or \`init.data.json\`).`;

    case 'PESTO':
      return `CODING MODE — LOCAL SYNCHRONIZATION: PESTO ARCHITECTURE
- You are operating in Local Synchronization mode targeting **Pesto**.
- Follow Pesto's hierarchy when calling \`save_artifact\`:
  - Service folders (\`ReplicatedStorage/\`, \`ServerScriptService/\`, \`StarterPlayer/StarterPlayerScripts/\`, \`Workspace/\`) mirror the Roblox DataModel.
  - Scripts use \`.server.luau\`, \`.client.luau\`, and \`.luau\` extensions alongside \`.pesto.yaml\` metadata definitions for instance properties and tags.`;

    case 'RBXMK':
      return `CODING MODE — LOCAL SYNCHRONIZATION: RBXMK ARCHITECTURE
- You are operating in Local Synchronization mode targeting **rbxmk**.
- Follow rbxmk's build layout when calling \`save_artifact\`:
  - Place hierarchy lives under \`game/<Service>/...\` with \`.server.luau\`, \`.client.luau\`, and \`.luau\` scripts and optional \`.desc.json\` descriptor files, orchestrated by \`build.lua\`.`;
  }
}

export interface PermissionsContractOptions {
  allowTerminalWithoutPermission?: boolean;
  allowExternalFilesWithoutPermission?: boolean;
  allowPcControlWithoutPermission?: boolean;
  pcIdleTakeoverSeconds?: number;
  sandboxAccessPolicy?: 'ALLOW' | 'ASK' | 'DENY';
  sandboxProviderKind?: 'LOCAL' | 'CLOUD_GPU';
  maxConcurrentSandboxes?: number;
  allowAutoSaveVersion?: boolean;
  allowAutoPublish?: boolean;
}

/**
 * Builds the authoritative File, Terminal, PC Desktop, Sandbox, and Roblox Studio Direct Permission Rules
 * injected into every agent's system prompt.
 */
export function buildPermissionsContract(
  allowTerminalWithoutPermission = false,
  allowExternalFilesWithoutPermission = false,
  options: PermissionsContractOptions = {},
): string {
  const allowPcControl = options.allowPcControlWithoutPermission ?? false;
  const idleTakeoverSeconds = options.pcIdleTakeoverSeconds ?? 60;
  const sandboxPolicy = options.sandboxAccessPolicy ?? 'ALLOW';
  const sandboxProvider = options.sandboxProviderKind ?? 'LOCAL';
  const maxSandboxes = options.maxConcurrentSandboxes ?? 15;
  const allowAutoSave = options.allowAutoSaveVersion ?? true;
  const allowAutoPublish = options.allowAutoPublish ?? true;

  const terminalRule = allowTerminalWithoutPermission
    ? `- **Terminal Command Execution (\`run_terminal_command\`) — AUTO-ALLOWED**: Studio settings currently allow executing terminal commands on Command Prompt (\`cmd\`), PowerShell (\`powershell\`, \`pwsh\`), and POSIX shells (\`bash\`, \`sh\`, \`wsl\`) immediately without pausing for confirmation.`
    : `- **Terminal Command Execution (\`run_terminal_command\`) — PERMISSION REQUIRED FIRST**: You can execute terminal commands on Command Prompt (\`cmd\`), PowerShell (\`powershell\`, \`pwsh\`), and other shells (\`bash\`, \`sh\`, \`wsl\`) using \`run_terminal_command\`. Because "Always allow terminal commands" is OFF in Settings, calling \`run_terminal_command\` will automatically pause and ask the human operator for permission first (unless already approved). Always provide a clear \`reason\` explaining why the command is needed.`;

  const fileRule = allowExternalFilesWithoutPermission
    ? `- **File Creation & Editing (\`/workspace/\` vs External) — AUTO-ALLOWED**: You may create and edit files inside \`/workspace/\` freely without permission, and Studio settings currently also allow writing files outside \`/workspace/\` without confirmation.`
    : `- **File Creation & Editing (\`/workspace/\` vs Outside \`/workspace/\`)**:
  1. **Inside \`/workspace/\` (NO PERMISSION NEEDED)**: You can freely create and edit any file inside \`/workspace/\` using relative paths (e.g. \`src/app.ts\`, \`Game/...\`) without asking for permission.
  2. **Outside \`/workspace/\` (PERMISSION REQUIRED FIRST)**: Writing or editing any file outside the \`/workspace/\` folder ALWAYS pauses to ask the human operator for permission first before any disk write occurs.
  3. **Agent File Comments**: Whenever you call \`save_artifact\` or \`edit_workspace_file\`, include a concise \`comment\` summarizing the file's purpose, architecture notes, or what changed in this version.`;

  const pcAndSandboxRule = `- **Direct PC Computer Use, 15-Agent Priority Hierarchy & Isolated Sandboxes (\`pc_observe\`, \`pc_act\`, \`pc_window\`, \`pc_sandbox\`)**:
  1. **All 15 Agents Have Access with Priority Preemption**: Priority order from highest need to lowest: \`playtest\` (100) > \`tester108\` (95) > \`builder\` (90) > \`scenic\` (85) > \`frame\` (80) > \`reviewer\` (75) > \`lead\` (70) > \`liveops\` (60) > \`architect\` (55) > \`balance\` (50) > \`merchant\` (45) > \`producer\` (40) > \`librarian\` (35) > \`splash\` (30) > \`pulse\` (20). Higher-priority agents automatically preempt lower-priority agents on the physical Main PC.
  2. **Up to ${maxSandboxes} Concurrent Sandboxes (\`pc_sandbox\`, \`targetEnv: "SANDBOX"\`, Policy: \`${sandboxPolicy}\`, Provider: \`${sandboxProvider}\`)**: Each of the 15 agents can instantiate and control its own isolated Sandbox simultaneously (local workspace + headless browser viewport + shell, or Cloud GPU / Dedicated VM) without disturbing the user's cursor.
  3. **Physical Main PC Control (\`targetEnv: "MAIN_PC"\`) & ${idleTakeoverSeconds}s Idle Auto-Takeover**:
     - ${allowPcControl ? 'Studio settings currently allow controlling the Main PC without asking for permission.' : `If the user is actively using the PC (< ${idleTakeoverSeconds}s idle), controlling the Main PC pauses and requests permission first. If the user has been idle for >= ${idleTakeoverSeconds}s, you are automatically granted Main PC control and can work until the user presses **Ctrl + Shift + Delete** (which immediately halts Main PC automation).`}`;

  const studioDirectRule = `- **Direct Roblox Studio Lifecycle & All Sync Methods (\`studio_direct\`)**:
  1. **Any & Every Sync Method Supported**: Use \`studio_direct\` with \`action: "sync_files"\` (or \`"pipeline"\`) and \`syncMethod\` set to \`"AUTO"\`, \`"RBXLX_BUILD"\` (compiles \`.rbxlx\` place files), \`"SILICON_SYNC"\`, \`"ROJO_SYNC"\`, \`"AZUL_SYNC"\`, \`"ARGON_SYNC"\`, \`"ROBLOX_MCP"\`, \`"OPEN_CLOUD_API"\`, \`"INSERT_FROM_FILE"\` (\`.rbxmx\` model insertion via Studio GUI), or \`"MANUAL_GUI_EDIT"\` (human-like script creation and code pasting in Studio).
  2. **Full Studio Automation Without Requiring MCP**: \`studio_direct\` can launch \`RobloxStudioBeta.exe\`, open experiences or \`.rbxlx\` files, create/edit scripts manually like a human (\`action: "manual_create_script"\`), run playtests (\`action: "playtest"\`, \`F5\`/\`F8\`/\`Shift+F5\`) while inspecting screenshots and \`%LOCALAPPDATA%\\Roblox\\logs\` output (\`action: "read_output"\`), save versions (\`action: "save"\`, ${allowAutoSave ? 'AUTO-ALLOWED without asking' : 'requires permission'}), and publish (\`action: "publish"\` via Open Cloud API or Studio GUI \`Alt+P\`, ${allowAutoPublish ? 'AUTO-ALLOWED without asking' : 'requires permission'}).`;

  return `WORKSPACE FILE, TERMINAL, PC & ROBLOX STUDIO DIRECT RULES\n${fileRule}\n${terminalRule}\n${pcAndSandboxRule}\n${studioDirectRule}`;
}

/**
 * Normalizes an artifact path for the studio's active CodingMode + CodingSyncTool
 * and returns any companion files (such as Silicon `Properties.yaml` files) that should be ensured on disk.
 */
export function normalizeArtifactForCodingMode(params: {
  path: string;
  language: string;
  content: string;
  codingMode: CodingMode;
  codingSyncTool: CodingSyncTool;
  contextMode?: ContextMode;
}): NormalizedArtifactPlan {
  const cleanRel = params.path
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '.' && s !== '..');

  if (cleanRel.length === 0) {
    return { normalizedPath: 'artifact.txt', companionFiles: [] };
  }

  // In GENERAL mode, never rewrite paths into Roblox Silicon `Game/.../Source.*.luau` folders
  if (params.contextMode === 'GENERAL') {
    const strippedWorkspacePrefix =
      cleanRel[0]?.toLowerCase() === 'workspace' && cleanRel.length > 1
        ? cleanRel.slice(1)
        : cleanRel;
    return {
      normalizedPath: strippedWorkspacePrefix.join('/'),
      companionFiles: [],
    };
  }

  // Only Silicon requires the Uniform Instance Folder transformation + Properties.yaml scaffolding
  if (
    params.codingMode !== 'LOCAL_SYNC' ||
    params.codingSyncTool !== 'SILICON'
  ) {
    return {
      normalizedPath: cleanRel.join('/'),
      companionFiles: [],
    };
  }

  const lastSeg = cleanRel[cleanRel.length - 1]!;
  const lowerLast = lastSeg.toLowerCase();

  // Leave non-Roblox markdown/docs at root unless already inside Game/
  const isLuaFile =
    params.language === 'luau' ||
    params.language === 'lua' ||
    lowerLast.endsWith('.luau') ||
    lowerLast.endsWith('.lua');
  const isPropertiesFile =
    lowerLast === 'properties.yaml' || lowerLast === 'properties.json';

  if (!isLuaFile && !isPropertiesFile) {
    return {
      normalizedPath: cleanRel.join('/'),
      companionFiles: [],
    };
  }

  // Strip leading "Game/" or "game/" if present so we can reconstruct uniformly
  const withoutGamePrefix =
    cleanRel[0]?.toLowerCase() === 'game' ? cleanRel.slice(1) : cleanRel;

  if (withoutGamePrefix.length === 0) {
    return {
      normalizedPath: cleanRel.join('/'),
      companionFiles: [],
    };
  }

  if (isPropertiesFile) {
    const dirSegments = withoutGamePrefix
      .slice(0, -1)
      .map(sanitizeSiliconInstanceName);
    const normalizedPath = ['Game', ...dirSegments, lastSeg].join('/');
    return {
      normalizedPath,
      companionFiles: [],
    };
  }

  // Determine if the file is already named `Source.(shared|client|server).luau`
  const exactSourceMatch = /^Source\.(shared|client|server)\.(?:luau|lua)$/i.exec(
    lastSeg,
  );

  let instanceFolderSegments: string[];
  let context: 'shared' | 'client' | 'server';

  if (exactSourceMatch) {
    context = exactSourceMatch[1]!.toLowerCase() as 'shared' | 'client' | 'server';
    instanceFolderSegments = withoutGamePrefix
      .slice(0, -1)
      .map(sanitizeSiliconInstanceName);
  } else {
    // Convert e.g. `CombatClient.client.luau`, `BossPhase2.server.luau`, or `AnimationHandler.luau`
    // into an instance folder `<ScriptName>/Source.<context>.luau`
    let baseName = lastSeg.replace(/\.(?:luau|lua)$/i, '');
    if (/\.server$/i.test(baseName)) {
      context = 'server';
      baseName = baseName.replace(/\.server$/i, '');
    } else if (/\.client$/i.test(baseName)) {
      context = 'client';
      baseName = baseName.replace(/\.client$/i, '');
    } else if (/\.shared$/i.test(baseName)) {
      context = 'shared';
      baseName = baseName.replace(/\.shared$/i, '');
    } else {
      // Infer from service root if no suffix was given
      const rootService = withoutGamePrefix[0] ?? '';
      if (/^ServerScriptService$/i.test(rootService)) {
        context = 'server';
      } else if (
        /^StarterPlayer$/i.test(rootService) ||
        /^StarterGui$/i.test(rootService) ||
        /^ReplicatedFirst$/i.test(rootService)
      ) {
        context = 'client';
      } else {
        context = 'shared';
      }
    }

    const parentSegments = withoutGamePrefix
      .slice(0, -1)
      .map(sanitizeSiliconInstanceName);
    const scriptFolder = sanitizeSiliconInstanceName(baseName);
    instanceFolderSegments = [...parentSegments, scriptFolder];
  }

  if (instanceFolderSegments.length === 0) {
    instanceFolderSegments = ['ReplicatedStorage', 'Module'];
  }

  const sourceFileName = `Source.${context}.luau`;
  const normalizedPath = [
    'Game',
    ...instanceFolderSegments,
    sourceFileName,
  ].join('/');

  const scriptClassName =
    context === 'server'
      ? 'Script'
      : context === 'client'
        ? 'LocalScript'
        : 'ModuleScript';

  // Generate companion `Properties.yaml` files for every ancestor folder and the script folder itself
  const companionFiles: CompanionFileSpec[] = [];
  for (let i = 0; i < instanceFolderSegments.length; i++) {
    const seg = instanceFolderSegments[i]!;
    const subPath = [
      'Game',
      ...instanceFolderSegments.slice(0, i + 1),
      'Properties.yaml',
    ].join('/');
    const isLeafScript = i === instanceFolderSegments.length - 1;
    const className = isLeafScript
      ? scriptClassName
      : ROBLOX_SERVICES.has(seg)
        ? seg
        : 'Folder';
    companionFiles.push({
      relativePath: subPath,
      content: buildSiliconPropertiesYaml(className),
      overwriteIfExisting: false,
    });
  }

  return {
    normalizedPath,
    companionFiles,
  };
}

/**
 * Parses a script path into a Roblox Studio DataModel target (`service`, `folderSegments`, `scriptName`, `className`, `dotPath`).
 */
export function parseRobloxStudioTargetFromPath(
  rawPath: string,
): RobloxMcpScriptTarget | null {
  const clean = rawPath
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '.' && s !== '..');

  if (clean.length === 0) return null;

  const withoutGame =
    clean[0]?.toLowerCase() === 'game' ? clean.slice(1) : clean;
  if (withoutGame.length === 0) return null;

  const last = withoutGame[withoutGame.length - 1]!;
  if (!/\.(?:luau|lua)$/i.test(last)) {
    return null;
  }

  let segments: string[];
  let className: 'Script' | 'LocalScript' | 'ModuleScript' = 'ModuleScript';

  const sourceMatch = /^Source\.(shared|client|server)\.(?:luau|lua)$/i.exec(
    last,
  );
  if (sourceMatch) {
    const ctx = sourceMatch[1]!.toLowerCase();
    className =
      ctx === 'server'
        ? 'Script'
        : ctx === 'client'
          ? 'LocalScript'
          : 'ModuleScript';
    segments = withoutGame.slice(0, -1);
  } else {
    let baseName = last.replace(/\.(?:luau|lua)$/i, '');
    if (/\.server$/i.test(baseName)) {
      className = 'Script';
      baseName = baseName.replace(/\.server$/i, '');
    } else if (/\.client$/i.test(baseName)) {
      className = 'LocalScript';
      baseName = baseName.replace(/\.client$/i, '');
    } else if (/\.shared$/i.test(baseName)) {
      className = 'ModuleScript';
      baseName = baseName.replace(/\.shared$/i, '');
    } else if (/^ServerScriptService$/i.test(withoutGame[0] ?? '')) {
      className = 'Script';
    } else if (
      /^StarterPlayer$/i.test(withoutGame[0] ?? '') ||
      /^StarterGui$/i.test(withoutGame[0] ?? '')
    ) {
      className = 'LocalScript';
    }
    segments = [...withoutGame.slice(0, -1), baseName];
  }

  if (segments.length < 2) {
    segments = ['ReplicatedStorage', segments[0] ?? 'Script'];
  }

  const service = segments[0]!;
  const folderSegments = segments.slice(1, -1);
  const scriptName = segments[segments.length - 1]!;
  const dotPath = ['game', service, ...folderSegments, scriptName].join('.');

  return {
    service,
    folderSegments,
    scriptName,
    className,
    dotPath,
  };
}

/**
 * Syncs a Luau script directly into an open Roblox Studio instance via the local Roblox Studio MCP Proxy (`%LOCALAPPDATA%\Roblox\mcp.bat`).
 */
export async function syncScriptViaRobloxStudioMcp(
  target: RobloxMcpScriptTarget,
  sourceCode: string,
): Promise<{ synced: boolean; studioId?: string; message: string }> {
  const localAppData = process.env['LOCALAPPDATA'] ?? '';
  const mcpBatPath = localAppData
    ? path.join(localAppData, 'Roblox', 'mcp.bat')
    : '';

  if (mcpBatPath) {
    const exists = await fs
      .access(mcpBatPath)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      return {
        synced: false,
        message: `Roblox Studio MCP proxy not found at ${mcpBatPath}`,
      };
    }
  } else {
    return {
      synced: false,
      message: 'LOCALAPPDATA environment variable is not set for Roblox Studio MCP',
    };
  }

  return new Promise((resolve) => {
    const child = spawn('cmd.exe', ['/c', 'cd /d %LOCALAPPDATA%\\Roblox && .\\mcp.bat'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let settled = false;
    const finish = (res: { synced: boolean; studioId?: string; message: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolve(res);
    };

    const timer = setTimeout(() => {
      finish({
        synced: false,
        message: 'Timed out waiting for Roblox Studio MCP proxy response',
      });
    }, 10_000);

    let buffer = '';
    let targetStudioId = '';

    const sendRpc = (msg: Record<string, unknown>) => {
      try {
        child.stdin.write(`${JSON.stringify(msg)}\n`);
      } catch {
        // ignore
      }
    };

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('{')) continue;
        try {
          const msg = JSON.parse(line) as {
            id?: number;
            result?: {
              content?: Array<{ type?: string; text?: string }>;
              isError?: boolean;
            };
            error?: { message?: string };
          };

          if (msg.id === 1) {
            sendRpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
            sendRpc({
              jsonrpc: '2.0',
              id: 2,
              method: 'tools/call',
              params: { name: 'list_roblox_studios', arguments: {} },
            });
          } else if (msg.id === 2) {
            const textOut =
              msg.result?.content?.map((c) => c.text ?? '').join('\n') ?? '';
            const idMatch =
              /"id"\s*:\s*"([^"]+)"/.exec(textOut) ??
              /studio[_-]?id["\s:=]+([a-zA-Z0-9_-]+)/i.exec(textOut);
            if (!idMatch?.[1]) {
              finish({
                synced: false,
                message: 'No active Roblox Studio instance connected to MCP proxy',
              });
              return;
            }
            targetStudioId = idMatch[1];

            // Build Luau snippet to ensure parent Folders exist and set Script.Source
            const luauCode = buildRobloxStudioUpsertScriptLuau(target, sourceCode);
            sendRpc({
              jsonrpc: '2.0',
              id: 3,
              method: 'tools/call',
              params: {
                name: 'execute_luau',
                arguments: {
                  studio_id: targetStudioId,
                  datamodel_type: 'Edit',
                  code: luauCode,
                },
              },
            });
          } else if (msg.id === 3) {
            if (msg.error || msg.result?.isError) {
              const errText =
                msg.error?.message ??
                msg.result?.content?.map((c) => c.text ?? '').join(' ') ??
                'Unknown MCP error';
              finish({
                synced: false,
                studioId: targetStudioId,
                message: `Roblox Studio MCP error: ${errText}`,
              });
            } else {
              finish({
                synced: true,
                studioId: targetStudioId,
                message: `Created/updated ${target.className} at ${target.dotPath} in Roblox Studio (${targetStudioId})`,
              });
            }
          }
        } catch {
          // ignore non-JSON lines
        }
      }
    });

    child.on('error', (err) => {
      finish({
        synced: false,
        message: `Failed to spawn Roblox Studio MCP proxy: ${err.message}`,
      });
    });

    child.on('close', () => {
      finish({
        synced: false,
        message: 'Roblox Studio MCP proxy closed before completion',
      });
    });

    sendRpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'robdev-control-room', version: '1.0.0' },
      },
    });
  });
}

function buildRobloxStudioUpsertScriptLuau(
  target: RobloxMcpScriptTarget,
  sourceCode: string,
): string {
  const folderListJson = JSON.stringify(target.folderSegments);
  const serviceJson = JSON.stringify(target.service);
  const scriptNameJson = JSON.stringify(target.scriptName);
  const classNameJson = JSON.stringify(target.className);
  const sourceJson = JSON.stringify(sourceCode);

  return `
local serviceName = ${serviceJson}
local folders = ${folderListJson}
local scriptName = ${scriptNameJson}
local className = ${classNameJson}
local sourceCode = ${sourceJson}

local ok, rootParent = pcall(function()
  return game:GetService(serviceName)
end)
if not ok or not rootParent then
  rootParent = game:FindFirstChild(serviceName)
end
if not rootParent then
  error("Service not found: " .. tostring(serviceName))
end

local currentParent = rootParent
for _, folderName in ipairs(folders) do
  local existing = currentParent:FindFirstChild(folderName)
  if not existing then
    if serviceName == "StarterPlayer" and (folderName == "StarterPlayerScripts" or folderName == "StarterCharacterScripts") then
      existing = currentParent:WaitForChild(folderName, 2)
    end
    if not existing then
      local f = Instance.new("Folder")
      f.Name = folderName
      f.Parent = currentParent
      existing = f
    end
  end
  currentParent = existing
end

local scriptInst = currentParent:FindFirstChild(scriptName)
if scriptInst and scriptInst.ClassName ~= className then
  scriptInst:Destroy()
  scriptInst = nil
end
if not scriptInst then
  scriptInst = Instance.new(className)
  scriptInst.Name = scriptName
  scriptInst.Parent = currentParent
end
scriptInst.Source = sourceCode
return scriptInst:GetFullName()
`.trim();
}

export interface LuauDiagnosticIssue {
  severity: 'error' | 'warning';
  line?: number;
  message: string;
}

export interface LuauDiagnosticsResult {
  valid: boolean;
  issues: LuauDiagnosticIssue[];
}

/**
 * Strips comments and string literals from Luau code while preserving newlines and line numbers.
 */
function stripLuauCommentsAndStrings(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;

  while (i < n) {
    const ch = source[i]!;
    const next = source[i + 1];

    // Block comment --[[ ... ]] or --[=[ ... ]=]
    if (ch === '-' && next === '-') {
      const longMatch = /^--\[(=*)\[/.exec(source.slice(i));
      if (longMatch) {
        const eq = longMatch[1] ?? '';
        const closeToken = `]${eq}]`;
        const closeIdx = source.indexOf(closeToken, i + longMatch[0].length);
        const end = closeIdx >= 0 ? closeIdx + closeToken.length : n;
        for (let k = i; k < end; k++) {
          out += source[k] === '\n' ? '\n' : ' ';
        }
        i = end;
        continue;
      }
      // Single-line comment
      const nlIdx = source.indexOf('\n', i);
      const end = nlIdx >= 0 ? nlIdx : n;
      i = end;
      continue;
    }

    // Multiline string [[ ... ]] or [=[ ... ]=]
    if (ch === '[' && (next === '[' || next === '=')) {
      const longStrMatch = /^\[(=*)\[/.exec(source.slice(i));
      if (longStrMatch) {
        const eq = longStrMatch[1] ?? '';
        const closeToken = `]${eq}]`;
        const closeIdx = source.indexOf(closeToken, i + longStrMatch[0].length);
        const end = closeIdx >= 0 ? closeIdx + closeToken.length : n;
        out += '""';
        for (let k = i; k < end; k++) {
          if (source[k] === '\n') out += '\n';
        }
        i = end;
        continue;
      }
    }

    // Quoted or backtick string
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out += quote;
      i += 1;
      while (i < n) {
        const c = source[i]!;
        if (c === '\\') {
          if (source[i + 1] === '\n') out += '\n';
          i += 2;
          continue;
        }
        if (c === '\n') {
          out += '\n';
        }
        i += 1;
        if (c === quote) break;
      }
      out += quote;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

/**
 * Performs static Luau syntax, block-balance, and production-readiness analysis.
 */
export function analyzeLuauCode(
  content: string,
  pathOrClassName = '',
): LuauDiagnosticsResult {
  const issues: LuauDiagnosticIssue[] = [];
  const rawLines = content.split(/\r?\n/);

  // 1. Check for unfinished TODO / FIXME / placeholder comments
  for (let idx = 0; idx < rawLines.length; idx++) {
    const line = rawLines[idx]!;
    if (/--\s*(?:TODO|FIXME|PLACEHOLDER|IMPLEMENT\s+HERE)\b/i.test(line)) {
      issues.push({
        severity: 'warning',
        line: idx + 1,
        message: `Unfinished placeholder comment detected ("${line.trim().slice(0, 80)}"). Write complete production implementation.`,
      });
    }
  }

  const stripped = stripLuauCommentsAndStrings(content);
  const strippedLines = stripped.split(/\r?\n/);

  const isClientScript =
    pathOrClassName === 'LocalScript' ||
    /\.(?:client)\.(?:luau|lua)$/i.test(pathOrClassName) ||
    /(?:^|\/)(?:StarterPlayer|StarterPlayerScripts|StarterCharacterScripts|StarterGui|ReplicatedFirst)\//i.test(
      pathOrClassName,
    );
  const isServerScript =
    pathOrClassName === 'Script' ||
    /\.(?:server)\.(?:luau|lua)$/i.test(pathOrClassName) ||
    /(?:^|\/)ServerScriptService\//i.test(pathOrClassName);

  // Check for --!strict header on non-trivial Luau scripts
  if (rawLines.length >= 5 && !/^--!\s*strict\b/m.test(content)) {
    issues.push({
      severity: 'warning',
      line: 1,
      message: 'Missing `--!strict` directive at top of Luau script.',
    });
  }

  // 2. Check deprecated globals, JS/Python syntax leakage, and Client/Server boundary violations
  for (let idx = 0; idx < strippedLines.length; idx++) {
    const line = strippedLines[idx]!;
    if (/(?:^|[^\w.:])(wait|spawn|delay)\s*\(/.test(line)) {
      const m = /(?:^|[^\w.:])(wait|spawn|delay)\s*\(/.exec(line);
      const fn = m?.[1] ?? 'wait';
      issues.push({
        severity: 'warning',
        line: idx + 1,
        message: `Deprecated global \`${fn}()\` used; prefer \`task.${fn}()\`.`,
      });
    }
    if (/\bgame\.Workspace\b/.test(line)) {
      issues.push({
        severity: 'warning',
        line: idx + 1,
        message:
          'Prefer global `workspace` or `game:GetService("Workspace")` over `game.Workspace`.',
      });
    }

    // Non-Luau syntax leakage (`!=`, `===`, `&&`, `||`, `const`/`let`, `null`/`undefined`, `else if`)
    if (/!==|===|!=/.test(line)) {
      issues.push({
        severity: 'error',
        line: idx + 1,
        message:
          'Invalid operator (`!=` / `===` / `!==`) in Luau; use `~=` for inequality and `==` for equality.',
      });
    }
    if (/&&|\|\|/.test(line)) {
      issues.push({
        severity: 'error',
        line: idx + 1,
        message:
          'Invalid boolean operator (`&&` or `||`) in Luau; use `and` / `or`.',
      });
    }
    if (/^\s*(?:const|let)\s+[a-zA-Z_]/.test(line)) {
      issues.push({
        severity: 'error',
        line: idx + 1,
        message:
          'Invalid variable declaration (`const` / `let`) in Luau; use `local`.',
      });
    }
    if (/\belse\s+if\b/.test(line)) {
      issues.push({
        severity: 'warning',
        line: idx + 1,
        message:
          'Found `else if` (two words) which opens a nested `if` block in Luau; use single-word `elseif`.',
      });
    }

    // Client / Server Roblox boundary enforcement
    if (isClientScript) {
      const rawLine = rawLines[idx] ?? '';
      const serverOnlyMatch =
        /\b(ServerStorage|ServerScriptService|DataStoreService|MemoryStoreService)\b/.exec(
          rawLine,
        );
      if (serverOnlyMatch?.[1] && !/^\s*--/.test(rawLine)) {
        issues.push({
          severity: 'error',
          line: idx + 1,
          message: `Client script cannot access server-only service \`${serverOnlyMatch[1]}\`. Communicate via a RemoteEvent/RemoteFunction in ReplicatedStorage instead.`,
        });
      }
    }
    if (isServerScript && /\bLocalPlayer\b/.test(line)) {
      issues.push({
        severity: 'error',
        line: idx + 1,
        message:
          '`Players.LocalPlayer` is always `nil` in a Server script. Use the `player` parameter from `PlayerAdded` or `RemoteEvent.OnServerEvent`.',
      });
    }
  }

  // 3. Check delimiter balance (), {}, []
  const stack: Array<{ char: string; expected: string; line: number }> = [];
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  const closers = new Set([')', '}', ']']);

  for (let idx = 0; idx < strippedLines.length; idx++) {
    const line = strippedLines[idx]!;
    for (const ch of line) {
      if (pairs[ch]) {
        stack.push({ char: ch, expected: pairs[ch]!, line: idx + 1 });
      } else if (closers.has(ch)) {
        const last = stack.pop();
        if (!last || last.expected !== ch) {
          issues.push({
            severity: 'error',
            line: idx + 1,
            message: `Unmatched closing delimiter '${ch}'${last ? ` (expected '${last.expected}' for '${last.char}' opened on line ${last.line})` : ''}.`,
          });
        }
      }
    }
  }
  for (const unclosed of stack) {
    issues.push({
      severity: 'error',
      line: unclosed.line,
      message: `Unclosed delimiter '${unclosed.char}' opened on line ${unclosed.line} (missing '${unclosed.expected}').`,
    });
  }

  // 4. Check Luau block balance (`function` / `then` / `do` vs `end`, and `repeat` vs `until`)
  // Note: In Luau, `for ... do` and `while ... do` have `do`, `if ... then` / `elseif ... then` have `then`.
  // Specifically:
  // - `function` opens an `end` block (except inside type declarations like `type Fn = () -> ()`)
  // - `if` opens an `end` block (and `elseif ... then` does NOT open an extra `end` block)
  // - `do` opens an `end` block (covers standalone `do ... end`, `for ... do ... end`, `while ... do ... end`)
  // - `repeat` opens an `until` block
  let endBalance = 0;
  let repeatBalance = 0;
  for (let idx = 0; idx < strippedLines.length; idx++) {
    const line = strippedLines[idx]!;
    const tokens = line.match(/\b(?:function|if|do|end|repeat|until)\b/g) ?? [];
    for (const tok of tokens) {
      if (tok === 'function' || tok === 'if' || tok === 'do') {
        endBalance += 1;
      } else if (tok === 'end') {
        endBalance -= 1;
        if (endBalance < 0) {
          issues.push({
            severity: 'error',
            line: idx + 1,
            message: 'Unexpected `end` keyword with no matching `function`, `if`, or `do` block.',
          });
          endBalance = 0;
        }
      } else if (tok === 'repeat') {
        repeatBalance += 1;
      } else if (tok === 'until') {
        repeatBalance -= 1;
        if (repeatBalance < 0) {
          issues.push({
            severity: 'error',
            line: idx + 1,
            message: 'Unexpected `until` keyword with no matching `repeat` block.',
          });
          repeatBalance = 0;
        }
      }
    }
  }

  if (endBalance > 0) {
    issues.push({
      severity: 'error',
      line: rawLines.length,
      message: `Missing ${endBalance} closing \`end\` statement(s) at end of script.`,
    });
  }
  if (repeatBalance > 0) {
    issues.push({
      severity: 'error',
      line: rawLines.length,
      message: `Missing ${repeatBalance} \`until\` condition(s) for \`repeat\` block.`,
    });
  }

  // 5. Check ModuleScript return requirement
  const isModuleScript =
    pathOrClassName === 'ModuleScript' ||
    /Source\.shared\.(?:luau|lua)$/i.test(pathOrClassName) ||
    (/\.(?:luau|lua)$/i.test(pathOrClassName) &&
      !/\.(?:server|client)\.(?:luau|lua)$/i.test(pathOrClassName) &&
      !/^ServerScriptService/i.test(pathOrClassName) &&
      !/^StarterPlayer/i.test(pathOrClassName) &&
      !/^StarterGui/i.test(pathOrClassName));

  if (isModuleScript && !/\breturn\b/.test(stripped)) {
    issues.push({
      severity: 'error',
      line: rawLines.length,
      message: 'ModuleScript must return a module table or function at the end of the file.',
    });
  }

  const hasError = issues.some((i) => i.severity === 'error');
  return {
    valid: !hasError,
    issues,
  };
}

/**
 * Calls a tool (`execute_luau`, `get_console_output`, or `start_stop_play`) on the active Roblox Studio instance via `%LOCALAPPDATA%\Roblox\mcp.bat`.
 */
export async function callRobloxStudioMcpTool(
  toolName: 'execute_luau' | 'get_console_output' | 'start_stop_play',
  toolArgs: Record<string, unknown>,
): Promise<{ ok: boolean; studioId?: string; output: string }> {
  const localAppData = process.env['LOCALAPPDATA'] ?? '';
  const mcpBatPath = localAppData
    ? path.join(localAppData, 'Roblox', 'mcp.bat')
    : '';

  if (!mcpBatPath) {
    return {
      ok: false,
      output: 'LOCALAPPDATA environment variable is not set for Roblox Studio MCP',
    };
  }

  const exists = await fs
    .access(mcpBatPath)
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    return {
      ok: false,
      output: `Roblox Studio MCP proxy not found at ${mcpBatPath}`,
    };
  }

  return new Promise((resolve) => {
    const child = spawn(
      'cmd.exe',
      ['/c', 'cd /d %LOCALAPPDATA%\\Roblox && .\\mcp.bat'],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

    let settled = false;
    const finish = (res: { ok: boolean; studioId?: string; output: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolve(res);
    };

    const timer = setTimeout(() => {
      finish({
        ok: false,
        output: 'Timed out waiting for Roblox Studio MCP proxy response',
      });
    }, 10_000);

    let buffer = '';
    let targetStudioId = '';

    const sendRpc = (msg: Record<string, unknown>) => {
      try {
        child.stdin.write(`${JSON.stringify(msg)}\n`);
      } catch {
        // ignore
      }
    };

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('{')) continue;
        try {
          const msg = JSON.parse(line) as {
            id?: number;
            result?: {
              content?: Array<{ type?: string; text?: string }>;
              isError?: boolean;
            };
            error?: { message?: string };
          };

          if (msg.id === 1) {
            sendRpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
            sendRpc({
              jsonrpc: '2.0',
              id: 2,
              method: 'tools/call',
              params: { name: 'list_roblox_studios', arguments: {} },
            });
          } else if (msg.id === 2) {
            const textOut =
              msg.result?.content?.map((c) => c.text ?? '').join('\n') ?? '';
            const idMatch =
              /"id"\s*:\s*"([^"]+)"/.exec(textOut) ??
              /studio[_-]?id["\s:=]+([a-zA-Z0-9_-]+)/i.exec(textOut);
            if (!idMatch?.[1]) {
              finish({
                ok: false,
                output: 'No active Roblox Studio instance connected to MCP proxy',
              });
              return;
            }
            targetStudioId = idMatch[1];

            sendRpc({
              jsonrpc: '2.0',
              id: 3,
              method: 'tools/call',
              params: {
                name: toolName,
                arguments: {
                  studio_id: targetStudioId,
                  ...toolArgs,
                },
              },
            });
          } else if (msg.id === 3) {
            const textOut =
              msg.result?.content?.map((c) => c.text ?? '').join('\n') ?? '';
            if (msg.error || msg.result?.isError) {
              finish({
                ok: false,
                studioId: targetStudioId,
                output: msg.error?.message ?? textOut ?? 'Unknown MCP error',
              });
            } else {
              finish({
                ok: true,
                studioId: targetStudioId,
                output: textOut,
              });
            }
          }
        } catch {
          // ignore non-JSON lines
        }
      }
    });

    child.on('error', (err) => {
      finish({
        ok: false,
        output: `Failed to spawn Roblox Studio MCP proxy: ${err.message}`,
      });
    });

    child.on('close', () => {
      finish({
        ok: false,
        output: 'Roblox Studio MCP proxy closed before completion',
      });
    });

    sendRpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'robdev-control-room', version: '1.0.0' },
      },
    });
  });
}
