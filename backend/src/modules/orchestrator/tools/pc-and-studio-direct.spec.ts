import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { AGENT_PC_PRIORITY } from '@robdev/shared';
import { describe, expect, it, vi } from 'vitest';
import { PcDesktopAutomationService } from './pc-desktop-automation.service.js';
import {
  compileWorkspaceToRbxlx,
  parseRobloxStudioLogText,
} from './roblox-xml-serializer.js';
import type { ToolContext } from './tool-context.js';

describe('PC Desktop Automation & Priority Preemption', () => {
  it('enforces AGENT_PC_PRIORITY hierarchy and preempts lower-priority agents on Main PC lock', () => {
    const svc = new PcDesktopAutomationService();

    expect(AGENT_PC_PRIORITY.playtest).toBeGreaterThan(
      AGENT_PC_PRIORITY.builder,
    );
    expect(AGENT_PC_PRIORITY.builder).toBeGreaterThan(AGENT_PC_PRIORITY.lead);
    expect(AGENT_PC_PRIORITY.lead).toBeGreaterThan(AGENT_PC_PRIORITY.pulse);

    // Lower priority agent acquires lock first
    const first = svc.acquireOrPreemptMainPcLock({
      agentKey: 'pulse',
      runId: 'run_pulse',
      mode: 'SETTINGS_AUTO_ALLOWED',
    });
    expect(first.acquired).toBe(true);

    // Higher priority agent (playtest) preempts pulse
    const second = svc.acquireOrPreemptMainPcLock({
      agentKey: 'playtest',
      runId: 'run_playtest',
      mode: 'SETTINGS_AUTO_ALLOWED',
    });
    expect(second.acquired).toBe(true);
    expect(second.preemptedAgent).toBe('pulse');

    // Lower priority agent (lead) cannot preempt playtest while playtest holds lock
    const third = svc.acquireOrPreemptMainPcLock({
      agentKey: 'lead',
      runId: 'run_lead',
      mode: 'SETTINGS_AUTO_ALLOWED',
    });
    expect(third.acquired).toBe(false);
    expect(third.heldByAgent).toBe('playtest');

    // Release playtest lock -> lead can now acquire
    svc.releaseMainPcLock('run_playtest');
    const fourth = svc.acquireOrPreemptMainPcLock({
      agentKey: 'lead',
      runId: 'run_lead',
      mode: 'SETTINGS_AUTO_ALLOWED',
    });
    expect(fourth.acquired).toBe(true);
  });

  it('auto-allows Main PC takeover when user idle >= pcIdleTakeoverSeconds and requires permission when active (< 60s)', async () => {
    const svc = new PcDesktopAutomationService();

    // Stub getMainPcIdleAndHotkeyState to simulate active user (12s idle)
    vi.spyOn(svc, 'getMainPcIdleAndHotkeyState').mockResolvedValueOnce({
      idleSeconds: 12,
      ctrlShiftDeletePressed: false,
      emergencyStopped: false,
    });

    const activeEval = await svc.evaluateMainPcAccess({
      allowPcControlWithoutPermission: false,
      pcIdleTakeoverSeconds: 60,
      taskMetadata: null,
    });
    expect(activeEval.allowed).toBe(false);
    expect(activeEval.mode).toBe('REQUIRES_PERMISSION');

    // Simulate user idle for 75s (>= 60s threshold)
    vi.spyOn(svc, 'getMainPcIdleAndHotkeyState').mockResolvedValueOnce({
      idleSeconds: 75,
      ctrlShiftDeletePressed: false,
      emergencyStopped: false,
    });

    const idleEval = await svc.evaluateMainPcAccess({
      allowPcControlWithoutPermission: false,
      pcIdleTakeoverSeconds: 60,
      taskMetadata: null,
    });
    expect(idleEval.allowed).toBe(true);
    expect(idleEval.mode).toBe('AUTO_IDLE_TAKEOVER');

    // Simulate Ctrl + Shift + Delete pressed -> halts Main PC automation
    vi.spyOn(svc, 'getMainPcIdleAndHotkeyState').mockResolvedValueOnce({
      idleSeconds: 0,
      ctrlShiftDeletePressed: true,
      emergencyStopped: true,
    });

    const stoppedEval = await svc.evaluateMainPcAccess({
      allowPcControlWithoutPermission: true,
      pcIdleTakeoverSeconds: 60,
      taskMetadata: { approvedMainPcControl: true },
    });
    expect(stoppedEval.allowed).toBe(false);
    expect(stoppedEval.mode).toBe('BLOCKED_BY_HOTKEY');
  });

  it('supports up to 15 concurrent isolated agent sandboxes (1 per agent)', async () => {
    const svc = new PcDesktopAutomationService();
    const s1 = await svc.ensureAgentSandbox({
      studioId: 'test_studio_sbx',
      studioSlug: 'test-studio',
      agentKey: 'builder',
      provider: 'CLOUD_GPU',
    });
    const s2 = await svc.ensureAgentSandbox({
      studioId: 'test_studio_sbx',
      studioSlug: 'test-studio',
      agentKey: 'playtest',
      provider: 'CLOUD_GPU',
    });

    expect(s1.agentKey).toBe('builder');
    expect(s2.agentKey).toBe('playtest');
    expect(s2.provider).toBe('CLOUD_GPU');
    expect(svc.listStudioSandboxes('test_studio_sbx').length).toBe(2);
    await svc.onModuleDestroy();
  });
});

describe('Roblox XML Place (.rbxlx / .rbxmx) Serializer & Studio Log Parser', () => {
  it('compiles workspace Luau scripts into valid .rbxlx place XML and .rbxmx service models', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'robdev-rbxlx-'));
    try {
      const mockCtx = {
        studioId: 'studio_test_1',
        prisma: {
          studio: {
            findUnique: async () => ({
              slug: 'test-studio',
              codingMode: 'LOCAL_SYNC',
              codingSyncTool: 'SILICON',
              contextMode: 'ROBLOX',
            }),
          },
          runArtifact: {
            findMany: async () => [
              {
                path: 'Game/ServerScriptService/CombatServer/Source.server.luau',
                bytes: 40,
                content: '--!strict\nprint("CombatServer initialized")\n',
              },
              {
                path: 'Game/ReplicatedStorage/Shared/DamageCalc/Source.shared.luau',
                bytes: 50,
                content: '--!strict\nlocal DamageCalc = {}\nreturn DamageCalc\n',
              },
            ],
            findFirst: async ({ where }: { where: { path: string } }) => {
              if (where.path.includes('CombatServer')) {
                return {
                  path: 'Game/ServerScriptService/CombatServer/Source.server.luau',
                  content: '--!strict\nprint("CombatServer initialized")\n',
                };
              }
              if (where.path.includes('DamageCalc')) {
                return {
                  path: 'Game/ReplicatedStorage/Shared/DamageCalc/Source.shared.luau',
                  content: '--!strict\nlocal DamageCalc = {}\nreturn DamageCalc\n',
                };
              }
              return null;
            },
          },
        },
      } as unknown as ToolContext;

      const compiled = await compileWorkspaceToRbxlx({
        ctx: mockCtx,
        outputDir: tmpDir,
        placeFileName: 'ArenaTest.rbxlx',
      });

      expect(compiled.scriptCount).toBeGreaterThanOrEqual(2);
      expect(Object.keys(compiled.modelFilePaths)).toContain(
        'ServerScriptService',
      );
      expect(Object.keys(compiled.modelFilePaths)).toContain(
        'ReplicatedStorage',
      );

      const xml = await fs.readFile(compiled.placeFilePath, 'utf8');
      expect(xml).toContain('<roblox ');
      expect(xml).toContain('<Item class="Script"');
      expect(xml).toContain('<Item class="ModuleScript"');
      expect(xml).toContain('CombatServer initialized');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('parses Roblox Studio log output lines into structured print/warn/error entries', () => {
    const raw = [
      '2026-10-25T01:01:45.210Z,0.210023,b28c,6 [FLog::Output] CombatServer initialized',
      '2026-10-25T01:01:46.100Z,1.100000,b28c,6,Warning [FLog::Output] High ping warning',
      '2026-10-25T01:01:47.500Z,2.500000,b28c,6,Error [FLog::Output] ServerScriptService.CombatServer:14: attempt to index nil with "Health"',
    ].join('\n');

    const parsed = parseRobloxStudioLogText(raw);
    expect(parsed.entries).toHaveLength(3);
    expect(parsed.entries[0]?.level).toBe('INFO');
    expect(parsed.entries[1]?.level).toBe('WARNING');
    expect(parsed.entries[2]?.level).toBe('ERROR');
    expect(parsed.errors[0]).toContain('attempt to index nil');
  });
});
