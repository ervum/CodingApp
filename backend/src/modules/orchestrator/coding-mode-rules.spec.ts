import { describe, expect, it } from 'vitest';
import {
  analyzeLuauCode,
  buildCodingModeContract,
  normalizeArtifactForCodingMode,
  parseRobloxStudioTargetFromPath,
} from './coding-mode-rules.js';

describe('coding-mode-rules', () => {
  it('builds Silicon Uniform Instance Folder instructions when LOCAL_SYNC + SILICON', () => {
    const contract = buildCodingModeContract('LOCAL_SYNC', 'SILICON');
    expect(contract).toContain('UNIFORM INSTANCE FOLDER ARCHITECTURE');
    expect(contract).toContain('Properties.yaml');
    expect(contract).toContain('Source.shared.luau');
    expect(contract).toContain('Source.client.luau');
    expect(contract).toContain('Source.server.luau');
  });

  it('builds Roblox Studio MCP instructions when ROBLOX_MCP', () => {
    const contract = buildCodingModeContract('ROBLOX_MCP', 'SILICON');
    expect(contract).toContain('DIRECT ROBLOX STUDIO MCP');
    expect(contract).toContain('execute_luau');
  });

  it('normalizes flat script paths into Silicon Uniform Instance Folder paths with Properties.yaml companions', () => {
    const plan = normalizeArtifactForCodingMode({
      path: 'StarterPlayer/StarterPlayerScripts/CombatClient.client.luau',
      language: 'luau',
      content: 'print("Combat ready")',
      codingMode: 'LOCAL_SYNC',
      codingSyncTool: 'SILICON',
    });

    expect(plan.normalizedPath).toBe(
      'Game/StarterPlayer/StarterPlayerScripts/CombatClient/Source.client.luau',
    );
    expect(plan.companionFiles.map((c) => c.relativePath)).toEqual([
      'Game/StarterPlayer/Properties.yaml',
      'Game/StarterPlayer/StarterPlayerScripts/Properties.yaml',
      'Game/StarterPlayer/StarterPlayerScripts/CombatClient/Properties.yaml',
    ]);
    expect(plan.companionFiles[2]?.content).toContain('ClassName: LocalScript');
    expect(plan.companionFiles[2]?.content).toContain('Archivable: true');
  });

  it('preserves already-formatted Silicon Source.<context>.luau paths and generates Properties.yaml', () => {
    const plan = normalizeArtifactForCodingMode({
      path: 'Game/ReplicatedStorage/Combat/DamageCalc/Source.shared.luau',
      language: 'luau',
      content: 'return {}',
      codingMode: 'LOCAL_SYNC',
      codingSyncTool: 'SILICON',
    });

    expect(plan.normalizedPath).toBe(
      'Game/ReplicatedStorage/Combat/DamageCalc/Source.shared.luau',
    );
    expect(plan.companionFiles.map((c) => c.relativePath)).toEqual([
      'Game/ReplicatedStorage/Properties.yaml',
      'Game/ReplicatedStorage/Combat/Properties.yaml',
      'Game/ReplicatedStorage/Combat/DamageCalc/Properties.yaml',
    ]);
    expect(plan.companionFiles[1]?.content).toContain('ClassName: Folder');
    expect(plan.companionFiles[2]?.content).toContain('ClassName: ModuleScript');
  });

  it('leaves Rojo paths unchanged when codingSyncTool is ROJO', () => {
    const plan = normalizeArtifactForCodingMode({
      path: 'src/client/CombatClient.client.luau',
      language: 'luau',
      content: 'print("Rojo")',
      codingMode: 'LOCAL_SYNC',
      codingSyncTool: 'ROJO',
    });

    expect(plan.normalizedPath).toBe('src/client/CombatClient.client.luau');
    expect(plan.companionFiles).toHaveLength(0);
  });

  it('parses Roblox Studio DataModel targets from both standard and Silicon paths', () => {
    const standard = parseRobloxStudioTargetFromPath(
      'ServerScriptService/Combat/HitboxServer.server.luau',
    );
    expect(standard).toEqual({
      service: 'ServerScriptService',
      folderSegments: ['Combat'],
      scriptName: 'HitboxServer',
      className: 'Script',
      dotPath: 'game.ServerScriptService.Combat.HitboxServer',
    });

    const silicon = parseRobloxStudioTargetFromPath(
      'Game/StarterPlayer/StarterPlayerScripts/CombatClient/Source.client.luau',
    );
    expect(silicon).toEqual({
      service: 'StarterPlayer',
      folderSegments: ['StarterPlayerScripts'],
      scriptName: 'CombatClient',
      className: 'LocalScript',
      dotPath: 'game.StarterPlayer.StarterPlayerScripts.CombatClient',
    });
  });

  it('analyzes Luau code for block balance, delimiters, ModuleScript return, and deprecated globals', () => {
    const cleanModule = analyzeLuauCode(
      `--!strict
local CombatMath = {}
function CombatMath.calcDamage(base: number, mult: number): number
  if base <= 0 then
    return 0
  end
  return base * mult
end
return CombatMath`,
      'Game/ReplicatedStorage/CombatMath/Source.shared.luau',
    );
    expect(cleanModule.valid).toBe(true);
    expect(cleanModule.issues).toHaveLength(0);

    const brokenModule = analyzeLuauCode(
      `local Broken = {}
function Broken.run()
  wait(1)
  if true then
    print("missing end for function")
end`,
      'Game/ReplicatedStorage/Broken/Source.shared.luau',
    );
    expect(brokenModule.valid).toBe(false);
    expect(brokenModule.issues.some((i) => i.message.includes('Missing 1 closing `end`'))).toBe(true);
    expect(brokenModule.issues.some((i) => i.message.includes('ModuleScript must return'))).toBe(true);
    expect(brokenModule.issues.some((i) => i.message.includes('Deprecated global `wait()`'))).toBe(true);
  });

  it('catches Client/Server boundary violations and JS/TS syntax leakage in Luau', () => {
    const clientAccessingServerStorage = analyzeLuauCode(
      `--!strict
local ServerStorage = game:GetService("ServerStorage")
local x = 1
if x != 2 && true then
  const y = 3
end`,
      'Game/StarterPlayer/StarterPlayerScripts/CombatClient/Source.client.luau',
    );
    expect(clientAccessingServerStorage.valid).toBe(false);
    expect(
      clientAccessingServerStorage.issues.some((i) =>
        i.message.includes('Client script cannot access server-only service `ServerStorage`'),
      ),
    ).toBe(true);
    expect(
      clientAccessingServerStorage.issues.some((i) =>
        i.message.includes('Invalid operator (`!=`'),
      ),
    ).toBe(true);
    expect(
      clientAccessingServerStorage.issues.some((i) =>
        i.message.includes('Invalid boolean operator (`&&`'),
      ),
    ).toBe(true);
    expect(
      clientAccessingServerStorage.issues.some((i) =>
        i.message.includes('Invalid variable declaration (`const`'),
      ),
    ).toBe(true);

    const serverUsingLocalPlayer = analyzeLuauCode(
      `--!strict
local Players = game:GetService("Players")
local lp = Players.LocalPlayer
print(lp)`,
      'Game/ServerScriptService/CombatServer/Source.server.luau',
    );
    expect(serverUsingLocalPlayer.valid).toBe(false);
    expect(
      serverUsingLocalPlayer.issues.some((i) =>
        i.message.includes('`Players.LocalPlayer` is always `nil` in a Server script'),
      ),
    ).toBe(true);
  });
});
