import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseRobloxStudioTargetFromPath } from '../coding-mode-rules.js';
import type { ToolContext } from './tool-context.js';
import {
  collectWorkspaceFileEntries,
  readWorkspaceFileContent,
} from './workspace-files.tools.js';

export interface RbxXmlNode {
  className: string;
  name: string;
  source?: string;
  children: Map<string, RbxXmlNode>;
}

const STANDARD_SERVICES = [
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
  'SoundService',
  'TextChatService',
] as const;

export function escapeXmlAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function wrapCdata(source: string): string {
  const safe = source.replace(/\]\]>/g, ']]]]><![CDATA[>');
  return `<![CDATA[${safe}]]>`;
}

/**
 * Builds an in-memory DataModel tree from all Luau scripts in the studio workspace.
 */
export async function buildDataModelTreeFromWorkspace(
  ctx: ToolContext,
): Promise<{
  services: Map<string, RbxXmlNode>;
  scriptCount: number;
  scriptPaths: string[];
}> {
  const services = new Map<string, RbxXmlNode>();
  for (const svc of STANDARD_SERVICES) {
    services.set(svc, {
      className: svc,
      name: svc,
      children: new Map(),
    });
  }

  // Ensure StarterPlayer has StarterPlayerScripts and StarterCharacterScripts
  const starterPlayer = services.get('StarterPlayer')!;
  starterPlayer.children.set('StarterPlayerScripts', {
    className: 'StarterPlayerScripts',
    name: 'StarterPlayerScripts',
    children: new Map(),
  });
  starterPlayer.children.set('StarterCharacterScripts', {
    className: 'StarterCharacterScripts',
    name: 'StarterCharacterScripts',
    children: new Map(),
  });

  const entries = await collectWorkspaceFileEntries(ctx, '', 7);
  const luauEntries = entries.filter(
    (e) =>
      /\.(?:luau|lua)$/i.test(e.path) &&
      !e.path.toLowerCase().includes('silicon/plugin') &&
      !e.path.toLowerCase().includes('recycle bin'),
  );

  let scriptCount = 0;
  const scriptPaths: string[] = [];

  for (const entry of luauEntries) {
    const loaded = await readWorkspaceFileContent(ctx, entry.path);
    if (!loaded) continue;

    // Map Rojo src/server|client|shared paths or Silicon Game/... paths
    let effectivePath = loaded.resolvedPath;
    if (/^src\/server\//i.test(effectivePath)) {
      effectivePath = effectivePath.replace(
        /^src\/server\//i,
        'ServerScriptService/',
      );
    } else if (/^src\/client\//i.test(effectivePath)) {
      effectivePath = effectivePath.replace(
        /^src\/client\//i,
        'StarterPlayer/StarterPlayerScripts/',
      );
    } else if (/^src\/shared\//i.test(effectivePath)) {
      effectivePath = effectivePath.replace(
        /^src\/shared\//i,
        'ReplicatedStorage/',
      );
    }

    const target = parseRobloxStudioTargetFromPath(effectivePath);
    if (!target) continue;

    let serviceNode = services.get(target.service);
    if (!serviceNode) {
      serviceNode = {
        className: target.service,
        name: target.service,
        children: new Map(),
      };
      services.set(target.service, serviceNode);
    }

    let currentParent = serviceNode;
    for (const folderName of target.folderSegments) {
      let existingFolder = currentParent.children.get(folderName);
      if (!existingFolder) {
        const folderClass =
          target.service === 'StarterPlayer' &&
          (folderName === 'StarterPlayerScripts' ||
            folderName === 'StarterCharacterScripts')
            ? folderName
            : 'Folder';
        existingFolder = {
          className: folderClass,
          name: folderName,
          children: new Map(),
        };
        currentParent.children.set(folderName, existingFolder);
      }
      currentParent = existingFolder;
    }

    currentParent.children.set(target.scriptName, {
      className: target.className,
      name: target.scriptName,
      source: loaded.content,
      children: new Map(),
    });

    scriptCount += 1;
    scriptPaths.push(target.dotPath);
  }

  return { services, scriptCount, scriptPaths };
}

function serializeNodeToXml(
  node: RbxXmlNode,
  refCounter: { next: number },
  indent = '  ',
  extraXmlInsideItem = '',
): string {
  const ref = `RBX${refCounter.next++}`;
  const lines: string[] = [];
  lines.push(`${indent}<Item class="${escapeXmlAttr(node.className)}" referent="${ref}">`);
  lines.push(`${indent}  <Properties>`);
  lines.push(`${indent}    <string name="Name">${escapeXmlAttr(node.name)}</string>`);
  if (typeof node.source === 'string') {
    lines.push(
      `${indent}    <ProtectedString name="Source">${wrapCdata(node.source)}</ProtectedString>`,
    );
  }
  lines.push(`${indent}  </Properties>`);
  if (extraXmlInsideItem) {
    lines.push(extraXmlInsideItem);
  }
  for (const child of node.children.values()) {
    lines.push(serializeNodeToXml(child, refCounter, `${indent}  `));
  }
  lines.push(`${indent}</Item>`);
  return lines.join('\n');
}

const DEFAULT_WORKSPACE_GEOMETRY_XML = `
    <Item class="Part" referent="RBX_BASEPLATE">
      <Properties>
        <string name="Name">Baseplate</string>
        <bool name="Anchored">true</bool>
        <bool name="Locked">true</bool>
        <Vector3 name="Position"><X>0</X><Y>-8</Y><Z>0</Z></Vector3>
        <Vector3 name="size"><X>512</X><Y>16</Y><Z>512</Z></Vector3>
        <Color3uint8 name="Color3uint8">4284702562</Color3uint8>
      </Properties>
    </Item>
    <Item class="SpawnLocation" referent="RBX_SPAWN">
      <Properties>
        <string name="Name">SpawnLocation</string>
        <bool name="Anchored">true</bool>
        <Vector3 name="Position"><X>0</X><Y>0.5</Y><Z>0</Z></Vector3>
        <Vector3 name="size"><X>12</X><Y>1</Y><Z>12</Z></Vector3>
      </Properties>
    </Item>
`.trimEnd();

/**
 * Compiles the workspace into a standalone `.rbxlx` place file and per-service `.rbxmx` model files.
 */
export async function compileWorkspaceToRbxlx(params: {
  ctx: ToolContext;
  outputDir: string;
  placeFileName?: string;
}): Promise<{
  placeFilePath: string;
  modelFilePaths: Record<string, string>;
  scriptCount: number;
  scriptPaths: string[];
}> {
  const { services, scriptCount, scriptPaths } =
    await buildDataModelTreeFromWorkspace(params.ctx);

  await fs.mkdir(params.outputDir, { recursive: true });
  const modelsDir = path.join(params.outputDir, 'Models');
  await fs.mkdir(modelsDir, { recursive: true });

  const refCounter = { next: 100 };
  const itemBlocks: string[] = [];

  for (const [svcName, svcNode] of services.entries()) {
    const extra =
      svcName === 'Workspace' ? DEFAULT_WORKSPACE_GEOMETRY_XML : '';
    itemBlocks.push(serializeNodeToXml(svcNode, refCounter, '  ', extra));
  }

  const placeXml = [
    '<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">',
    '  <External>null</External>',
    '  <External>nil</External>',
    ...itemBlocks,
    '</roblox>',
    '',
  ].join('\n');

  const safePlaceFile =
    params.placeFileName?.replace(/[^a-zA-Z0-9._-]/g, '_') ||
    'RobDevExperience.rbxlx';
  const finalPlaceFile = safePlaceFile.endsWith('.rbxlx')
    ? safePlaceFile
    : `${safePlaceFile}.rbxlx`;
  const placeFilePath = path.join(params.outputDir, finalPlaceFile);
  await fs.writeFile(placeFilePath, placeXml, 'utf8');

  // Also write per-service .rbxmx model files for "Insert From File"
  const modelFilePaths: Record<string, string> = {};
  for (const [svcName, svcNode] of services.entries()) {
    if (svcNode.children.size === 0) continue;
    const childBlocks: string[] = [];
    for (const child of svcNode.children.values()) {
      childBlocks.push(serializeNodeToXml(child, refCounter, '  '));
    }
    const modelXml = [
      '<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">',
      '  <External>null</External>',
      '  <External>nil</External>',
      ...childBlocks,
      '</roblox>',
      '',
    ].join('\n');
    const modelPath = path.join(modelsDir, `${svcName}.rbxmx`);
    await fs.writeFile(modelPath, modelXml, 'utf8');
    modelFilePaths[svcName] = modelPath;
  }

  return {
    placeFilePath,
    modelFilePaths,
    scriptCount,
    scriptPaths,
  };
}

export interface StudioLogEntry {
  timestamp: string;
  level: 'INFO' | 'WARNING' | 'ERROR';
  channel: string;
  message: string;
}

const NOISE_PATTERNS = [
  /Redundant Flag ID:/i,
  /Creating PolicyContext/i,
  /settingsUrl:/i,
  /Session GUID is/i,
  /Machine GUID is/i,
  /isSupportedInstallLocation/i,
  /All use of Roblox services must comply/i,
  /BaseUrl: https:\/\/www\.roblox\.com/i,
];

/**
 * Parses lines from a Roblox Studio `*_Studio_*_last.log` file, filtering out internal engine flag noise
 * and extracting user `print()`, `warn()`, Luau errors, and stack traces.
 */
export function parseRobloxStudioLogText(
  rawText: string,
  sinceIsoTimestamp?: string,
): {
  entries: StudioLogEntry[];
  errors: string[];
  warnings: string[];
  outputs: string[];
  isUserSignedIn: boolean | null;
} {
  const lines = rawText.split(/\r?\n/);
  const entries: StudioLogEntry[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const outputs: string[] = [];
  let isUserSignedIn: boolean | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/Is Studio Configured User Id Present:\s*true/i.test(line)) {
      isUserSignedIn = true;
    } else if (/Is Studio Configured User Id Present:\s*false/i.test(line)) {
      isUserSignedIn = false;
    }

    if (NOISE_PATTERNS.some((re) => re.test(line))) {
      continue;
    }

    const match =
      /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z),[\d.]+,[0-9a-f]+,\d+(?:,(Warning|Error|Info))?\s*\[FLog::([A-Za-z0-9_]+)\]\s*(.*)$/.exec(
        line,
      );

    if (match) {
      const ts = match[1]!;
      if (sinceIsoTimestamp && ts < sinceIsoTimestamp) {
        continue;
      }
      const rawSeverity = (match[2] ?? '').toUpperCase();
      const channel = match[3]!;
      const msg = match[4]!.trim();

      if (
        channel !== 'Output' &&
        channel !== 'Error' &&
        channel !== 'Warning' &&
        rawSeverity !== 'ERROR'
      ) {
        continue;
      }

      const level: StudioLogEntry['level'] =
        rawSeverity === 'ERROR' || channel === 'Error'
          ? 'ERROR'
          : rawSeverity === 'WARNING' || channel === 'Warning'
            ? 'WARNING'
            : 'INFO';

      entries.push({ timestamp: ts, level, channel, message: msg });
      if (level === 'ERROR') {
        errors.push(msg);
      } else if (level === 'WARNING') {
        warnings.push(msg);
      } else {
        outputs.push(msg);
      }
    } else if (
      /\b(?:Stack Begin|Stack End|Script '|attempt to |ServerScriptService\.|ReplicatedStorage\.|StarterPlayer\.)/i.test(
        line,
      )
    ) {
      errors.push(line);
    }
  }

  return {
    entries: entries.slice(-150),
    errors: errors.slice(-50),
    warnings: warnings.slice(-50),
    outputs: outputs.slice(-100),
    isUserSignedIn,
  };
}

/**
 * Reads the newest `%LOCALAPPDATA%\Roblox\logs\*_Studio_*_last.log` file on disk.
 */
export async function readLatestRobloxStudioDiskLog(
  sinceIsoTimestamp?: string,
): Promise<{
  logFilePath: string | null;
  entries: StudioLogEntry[];
  errors: string[];
  warnings: string[];
  outputs: string[];
  isUserSignedIn: boolean | null;
}> {
  const localAppData = process.env['LOCALAPPDATA'] ?? '';
  if (!localAppData) {
    return {
      logFilePath: null,
      entries: [],
      errors: [],
      warnings: [],
      outputs: [],
      isUserSignedIn: null,
    };
  }

  const logsDir = path.join(localAppData, 'Roblox', 'logs');
  const dirEntries = await fs.readdir(logsDir).catch(() => []);
  const studioLogs = dirEntries.filter(
    (name) => name.includes('_Studio_') && name.endsWith('.log'),
  );

  if (studioLogs.length === 0) {
    return {
      logFilePath: null,
      entries: [],
      errors: [],
      warnings: [],
      outputs: [],
      isUserSignedIn: null,
    };
  }

  const withStats = await Promise.all(
    studioLogs.map(async (name) => {
      const fullPath = path.join(logsDir, name);
      const st = await fs.stat(fullPath).catch(() => null);
      return { fullPath, mtimeMs: st?.mtimeMs ?? 0, size: st?.size ?? 0 };
    }),
  );
  withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const newest = withStats[0]!;

  // Read last 256 KB of the log file for speed
  const handle = await fs.open(newest.fullPath, 'r').catch(() => null);
  if (!handle) {
    return {
      logFilePath: newest.fullPath,
      entries: [],
      errors: [],
      warnings: [],
      outputs: [],
      isUserSignedIn: null,
    };
  }

  try {
    const readBytes = Math.min(newest.size, 256 * 1024);
    const startOffset = Math.max(0, newest.size - readBytes);
    const buf = Buffer.alloc(readBytes);
    await handle.read(buf, 0, readBytes, startOffset);
    const parsed = parseRobloxStudioLogText(
      buf.toString('utf8'),
      sinceIsoTimestamp,
    );
    return {
      logFilePath: newest.fullPath,
      ...parsed,
    };
  } finally {
    await handle.close().catch(() => {});
  }
}
