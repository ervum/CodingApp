import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  AGENT_PC_PRIORITY,
  type AgentKey,
  type PcStep,
  type PcTarget,
  type SandboxProviderKind,
} from '@robdev/shared';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import {
  executeShellCommand,
  getWorkspaceRoots,
} from './terminal-and-permissions.helper.js';
import type { ToolResultImage } from './tool-context.js';

export interface UiAutomationElement {
  id: number;
  name: string;
  controlType: string;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export interface WindowSummary {
  hwnd: number;
  pid: number;
  processName: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isForeground: boolean;
  isMinimized: boolean;
}

export interface ScreenObservationResult {
  ok: boolean;
  targetEnv: 'MAIN_PC' | 'SANDBOX';
  target: string;
  windowTitle: string;
  originX: number;
  originY: number;
  width: number;
  height: number;
  cursorX: number;
  cursorY: number;
  idleSeconds: number;
  ctrlShiftDeletePressed: boolean;
  elements: UiAutomationElement[];
  openWindows?: WindowSummary[];
  ocrText: string;
  screenshotPath: string;
  mediaId?: string;
  image?: ToolResultImage;
}

export interface AgentSandboxInstance {
  agentKey: AgentKey;
  studioId: string;
  provider: SandboxProviderKind;
  workspaceDir: string;
  createdAt: string;
  lastActiveAt: string;
  status: 'READY' | 'BUSY' | 'STOPPED';
  cloudEndpoint: string | null;
  currentUrl: string | null;
  viewport: { width: number; height: number };
  browserContext?: BrowserContext;
  page?: Page;
  lastElements: UiAutomationElement[];
}

export interface MainPcLockState {
  holderAgentKey: AgentKey;
  holderRunId: string;
  holderPriority: number;
  acquiredAt: number;
  mode: 'PERMISSION_GRANTED' | 'AUTO_IDLE_TAKEOVER' | 'SETTINGS_AUTO_ALLOWED';
}

/**
 * Shared C# Win32 + UI Automation + DPI-aware capture helper loaded in PowerShell.
 */
const WIN32_CSHARP_HELPER = `
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

public class RobDevWin32 {
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();

    [StructLayout(LayoutKind.Sequential)]
    public struct LASTINPUTINFO {
        public uint cbSize;
        public uint dwTime;
    }

    [DllImport("user32.dll")]
    public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern uint MapVirtualKey(uint uCode, uint uMapType);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    public const uint MOUSEEVENTF_MOVE = 0x0001;
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    public const uint MOUSEEVENTF_WHEEL = 0x0800;
    public const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
    public const uint KEYEVENTF_KEYUP = 0x0002;

    public static double GetIdleSeconds() {
        LASTINPUTINFO lii = new LASTINPUTINFO();
        lii.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO));
        if (!GetLastInputInfo(ref lii)) return 0.0;
        uint tick = (uint)Environment.TickCount;
        uint elapsed = tick >= lii.dwTime ? (tick - lii.dwTime) : 0;
        return elapsed / 1000.0;
    }

    public static bool IsCtrlShiftDeleteDown() {
        bool ctrl = (GetAsyncKeyState(0x11) & 0x8000) != 0;
        bool shift = (GetAsyncKeyState(0x10) & 0x8000) != 0;
        bool del = (GetAsyncKeyState(0x2E) & 0x8000) != 0;
        POINT pt;
        bool cornerFailsafe = GetCursorPos(out pt) && pt.X <= 1 && pt.Y <= 1;
        return (ctrl && shift && del) || cornerFailsafe;
    }

    public static void SendHardwareKey(byte vk, bool down) {
        byte scan = (byte)MapVirtualKey(vk, 0);
        uint flags = down ? 0u : KEYEVENTF_KEYUP;
        keybd_event(vk, scan, flags, UIntPtr.Zero);
    }

    public static void ClickAt(int x, int y, string button, int count) {
        SetCursorPos(x, y);
        Thread.Sleep(35);
        uint downFlag = MOUSEEVENTF_LEFTDOWN;
        uint upFlag = MOUSEEVENTF_LEFTUP;
        if (button == "right") { downFlag = MOUSEEVENTF_RIGHTDOWN; upFlag = MOUSEEVENTF_RIGHTUP; }
        else if (button == "middle") { downFlag = MOUSEEVENTF_MIDDLEDOWN; upFlag = MOUSEEVENTF_MIDDLEUP; }
        for (int i = 0; i < count; i++) {
            mouse_event(downFlag, 0, 0, 0, UIntPtr.Zero);
            Thread.Sleep(30);
            mouse_event(upFlag, 0, 0, 0, UIntPtr.Zero);
            if (i + 1 < count) Thread.Sleep(55);
        }
    }

    public static void DragBetween(int x1, int y1, int x2, int y2, string button) {
        uint downFlag = button == "right" ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_LEFTDOWN;
        uint upFlag = button == "right" ? MOUSEEVENTF_RIGHTUP : MOUSEEVENTF_LEFTUP;
        SetCursorPos(x1, y1);
        Thread.Sleep(40);
        mouse_event(downFlag, 0, 0, 0, UIntPtr.Zero);
        int steps = 10;
        for (int i = 1; i <= steps; i++) {
            int cx = x1 + ((x2 - x1) * i) / steps;
            int cy = y1 + ((y2 - y1) * i) / steps;
            SetCursorPos(cx, cy);
            Thread.Sleep(18);
        }
        mouse_event(upFlag, 0, 0, 0, UIntPtr.Zero);
    }

    public static void MouseLookRelative(int dx, int dy, bool holdRight) {
        if (holdRight) {
            mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, UIntPtr.Zero);
            Thread.Sleep(25);
        }
        int steps = 8;
        for (int i = 0; i < steps; i++) {
            mouse_event(MOUSEEVENTF_MOVE, dx / steps, dy / steps, 0, UIntPtr.Zero);
            Thread.Sleep(15);
        }
        if (holdRight) {
            Thread.Sleep(25);
            mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, UIntPtr.Zero);
        }
    }

    public static List<Dictionary<string, object>> GetVisibleWindows() {
        List<Dictionary<string, object>> results = new List<Dictionary<string, object>>();
        HashSet<long> seenHwnds = new HashSet<long>();
        IntPtr fg = GetForegroundWindow();

        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
            try {
                if (!IsWindowVisible(hWnd)) return true;
                StringBuilder sb = new StringBuilder(512);
                int len = GetWindowText(hWnd, sb, 512);
                if (len <= 0) return true;
                string title = sb.ToString().Trim();
                if (string.IsNullOrEmpty(title) || title == "Program Manager" || title == "Default IME" || title == "MSCTFIME UI") {
                    return true;
                }
                RECT rect;
                if (!GetWindowRect(hWnd, out rect)) return true;
                int w = rect.Right - rect.Left;
                int ht = rect.Bottom - rect.Top;
                bool minimized = IsIconic(hWnd);
                if (!minimized && (w <= 30 || ht <= 30)) return true;

                uint pid = 0;
                GetWindowThreadProcessId(hWnd, out pid);
                string procName = "unknown";
                if (pid != 0) {
                    try {
                        procName = Process.GetProcessById((int)pid).ProcessName;
                    } catch {}
                }

                long hwndVal = hWnd.ToInt64();
                seenHwnds.Add(hwndVal);
                Dictionary<string, object> item = new Dictionary<string, object>();
                item["hwnd"] = hwndVal;
                item["pid"] = (int)pid;
                item["processName"] = procName;
                item["title"] = title;
                item["x"] = rect.Left;
                item["y"] = rect.Top;
                item["width"] = w;
                item["height"] = ht;
                item["isForeground"] = (hWnd == fg);
                item["isMinimized"] = minimized;
                results.Add(item);
            } catch {}
            return true;
        }, IntPtr.Zero);

        try {
            Process[] procs = Process.GetProcesses();
            for (int i = 0; i < procs.Length; i++) {
                Process p = procs[i];
                try {
                    IntPtr h = p.MainWindowHandle;
                    if (h == IntPtr.Zero) continue;
                    long hwndVal = h.ToInt64();
                    if (seenHwnds.Contains(hwndVal)) continue;
                    string title = (p.MainWindowTitle ?? "").Trim();
                    if (string.IsNullOrEmpty(title)) continue;
                    RECT rect;
                    GetWindowRect(h, out rect);
                    int w = rect.Right - rect.Left;
                    int ht = rect.Bottom - rect.Top;
                    if (w <= 0 || ht <= 0) continue;
                    seenHwnds.Add(hwndVal);
                    Dictionary<string, object> item = new Dictionary<string, object>();
                    item["hwnd"] = hwndVal;
                    item["pid"] = p.Id;
                    item["processName"] = p.ProcessName;
                    item["title"] = title;
                    item["x"] = rect.Left;
                    item["y"] = rect.Top;
                    item["width"] = w;
                    item["height"] = ht;
                    item["isForeground"] = (h == fg);
                    item["isMinimized"] = IsIconic(h);
                    results.Add(item);
                } catch {}
            }
        } catch {}

        return results;
    }
}
`;

@Injectable()
export class PcDesktopAutomationService implements OnModuleDestroy {
  private readonly logger = new Logger(PcDesktopAutomationService.name);

  /** Up to 15 concurrent sandboxes (keyed by `${studioId}::${agentKey}`) */
  private readonly sandboxes = new Map<string, AgentSandboxInstance>();

  /** Last Main PC observation cache per studio for elementId & coordinate mapping */
  private readonly lastMainPcObservation = new Map<
    string,
    {
      timestamp: number;
      originX: number;
      originY: number;
      width: number;
      height: number;
      elements: UiAutomationElement[];
    }
  >();

  /** Priority-aware lock for the single physical Main PC */
  private mainPcLock: MainPcLockState | null = null;

  /** Emergency stop latch triggered when user presses Ctrl + Shift + Delete */
  private emergencyStopUntil = 0;

  async onModuleDestroy(): Promise<void> {
    for (const sb of this.sandboxes.values()) {
      await sb.browserContext?.close().catch(() => {});
    }
    this.sandboxes.clear();
  }

  /**
   * Returns the priority score (100 = highest need, 20 = lowest need) for any of the 15 agents.
   */
  getAgentPriority(agentKey: AgentKey): number {
    return AGENT_PC_PRIORITY[agentKey] ?? 50;
  }

  /**
   * Checks whether an agent can acquire or preempt the Main PC lock based on the 15-agent priority hierarchy.
   */
  acquireOrPreemptMainPcLock(params: {
    agentKey: AgentKey;
    runId: string;
    mode: MainPcLockState['mode'];
  }): {
    acquired: boolean;
    preemptedAgent?: AgentKey;
    heldByAgent?: AgentKey;
    heldByPriority?: number;
    requesterPriority: number;
  } {
    const requesterPriority = this.getAgentPriority(params.agentKey);
    const now = Date.now();

    // Expire stale locks (> 2 minutes without activity)
    if (this.mainPcLock && now - this.mainPcLock.acquiredAt > 120_000) {
      this.mainPcLock = null;
    }

    if (
      !this.mainPcLock ||
      this.mainPcLock.holderRunId === params.runId ||
      this.mainPcLock.holderAgentKey === params.agentKey
    ) {
      this.mainPcLock = {
        holderAgentKey: params.agentKey,
        holderRunId: params.runId,
        holderPriority: requesterPriority,
        acquiredAt: now,
        mode: params.mode,
      };
      return { acquired: true, requesterPriority };
    }

    // Priority hierarchy check: higher-priority agent preempts lower-priority agent!
    if (requesterPriority > this.mainPcLock.holderPriority) {
      const preempted = this.mainPcLock.holderAgentKey;
      this.mainPcLock = {
        holderAgentKey: params.agentKey,
        holderRunId: params.runId,
        holderPriority: requesterPriority,
        acquiredAt: now,
        mode: params.mode,
      };
      return {
        acquired: true,
        preemptedAgent: preempted,
        requesterPriority,
      };
    }

    return {
      acquired: false,
      heldByAgent: this.mainPcLock.holderAgentKey,
      heldByPriority: this.mainPcLock.holderPriority,
      requesterPriority,
    };
  }

  releaseMainPcLock(runId: string): void {
    if (this.mainPcLock && this.mainPcLock.holderRunId === runId) {
      this.mainPcLock = null;
    }
  }

  /**
   * Queries user idle seconds (via Win32 `GetLastInputInfo`) and whether `Ctrl + Shift + Delete` is pressed.
   */
  async getMainPcIdleAndHotkeyState(): Promise<{
    idleSeconds: number;
    ctrlShiftDeletePressed: boolean;
    emergencyStopped: boolean;
  }> {
    const script = `
Add-Type -TypeDefinition @'
${WIN32_CSHARP_HELPER}
'@ -ReferencedAssemblies System.Drawing, System.Windows.Forms -ErrorAction SilentlyContinue
$idle = [RobDevWin32]::GetIdleSeconds()
$stop = [RobDevWin32]::IsCtrlShiftDeleteDown()
Write-Output (@{ idleSeconds = [Math]::Round($idle, 2); ctrlShiftDeletePressed = $stop } | ConvertTo-Json -Compress)
`.trim();

    const res = await executeShellCommand({
      command: script,
      shell: 'powershell',
      cwd: process.cwd(),
      timeoutMs: 8_000,
    });

    if (res.ok && res.stdout) {
      try {
        const jsonLine = res.stdout
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find((l) => l.startsWith('{'));
        if (jsonLine) {
          const parsed = JSON.parse(jsonLine) as {
            idleSeconds?: number;
            ctrlShiftDeletePressed?: boolean;
          };
          if (parsed.ctrlShiftDeletePressed) {
            this.emergencyStopUntil = Date.now() + 30_000;
            this.mainPcLock = null;
          }
          return {
            idleSeconds: parsed.idleSeconds ?? 0,
            ctrlShiftDeletePressed: Boolean(parsed.ctrlShiftDeletePressed),
            emergencyStopped: Date.now() < this.emergencyStopUntil,
          };
        }
      } catch {
        // ignore parse errors
      }
    }

    return {
      idleSeconds: 0,
      ctrlShiftDeletePressed: false,
      emergencyStopped: Date.now() < this.emergencyStopUntil,
    };
  }

  /**
   * Evaluates whether an agent is allowed to control the Main PC right now:
   * - If `Ctrl + Shift + Delete` was pressed, blocks immediately.
   * - If `allowPcControlWithoutPermission` is true in Studio Settings, or already approved for this task: allowed.
   * - If user has been idle for >= `pcIdleTakeoverSeconds` (default 60s), automatically allows Main PC control until `Ctrl + Shift + Delete` is pressed!
   * - If user is actively using the PC (`idleSeconds < 60`), requires human permission first.
   */
  async evaluateMainPcAccess(params: {
    allowPcControlWithoutPermission: boolean;
    pcIdleTakeoverSeconds: number;
    taskMetadata: Record<string, unknown> | null;
  }): Promise<{
    allowed: boolean;
    mode: MainPcLockState['mode'] | 'BLOCKED_BY_HOTKEY' | 'REQUIRES_PERMISSION';
    idleSeconds: number;
    reason: string;
  }> {
    const state = await this.getMainPcIdleAndHotkeyState();
    if (state.ctrlShiftDeletePressed || state.emergencyStopped) {
      return {
        allowed: false,
        mode: 'BLOCKED_BY_HOTKEY',
        idleSeconds: state.idleSeconds,
        reason:
          'Main PC control was halted by the operator pressing Ctrl + Shift + Delete (or moving the mouse to the (0,0) failsafe corner).',
      };
    }

    const approvedInTask =
      params.taskMetadata?.['approvedMainPcControl'] === true ||
      (Array.isArray(params.taskMetadata?.['approvedTerminalCommands']) &&
        (params.taskMetadata?.['approvedTerminalCommands'] as string[]).includes(
          'MAIN_PC_CONTROL',
        ));

    if (params.allowPcControlWithoutPermission) {
      return {
        allowed: true,
        mode: 'SETTINGS_AUTO_ALLOWED',
        idleSeconds: state.idleSeconds,
        reason: 'Allowed by Studio setting (allowPcControlWithoutPermission = true).',
      };
    }

    if (approvedInTask) {
      return {
        allowed: true,
        mode: 'PERMISSION_GRANTED',
        idleSeconds: state.idleSeconds,
        reason: 'Main PC control approved by operator for this task.',
      };
    }

    const threshold = Math.max(10, params.pcIdleTakeoverSeconds || 60);
    if (state.idleSeconds >= threshold) {
      return {
        allowed: true,
        mode: 'AUTO_IDLE_TAKEOVER',
        idleSeconds: state.idleSeconds,
        reason: `Operator has been idle for ${Math.round(state.idleSeconds)}s (>= ${threshold}s threshold). Automatically taking control of Main PC until Ctrl + Shift + Delete is pressed.`,
      };
    }

    return {
      allowed: false,
      mode: 'REQUIRES_PERMISSION',
      idleSeconds: state.idleSeconds,
      reason: `Operator is actively using the PC (idle ${Math.round(state.idleSeconds)}s < ${threshold}s). Requesting permission before controlling Main PC mouse/keyboard.`,
    };
  }

  /**
   * Lists visible top-level windows on the Main PC.
   */
  async listWindows(): Promise<WindowSummary[]> {
    const script = `
Add-Type -TypeDefinition @'
${WIN32_CSHARP_HELPER}
'@ -ReferencedAssemblies System.Drawing, System.Windows.Forms -ErrorAction SilentlyContinue
[RobDevWin32]::SetProcessDPIAware() | Out-Null
$list = [RobDevWin32]::GetVisibleWindows()
if ($list.Count -eq 0) {
  $fg = [RobDevWin32]::GetForegroundWindow()
  $procs = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 }
  foreach ($p in $procs) {
    $h = $p.MainWindowHandle
    $rect = New-Object RobDevWin32+RECT
    [RobDevWin32]::GetWindowRect($h, [ref]$rect) | Out-Null
    $w = $rect.Right - $rect.Left
    $ht = $rect.Bottom - $rect.Top
    if ($w -le 0 -or $ht -le 0) { continue }
    $d = New-Object 'System.Collections.Generic.Dictionary[string,object]'
    $d['hwnd'] = $h.ToInt64()
    $d['pid'] = $p.Id
    $d['processName'] = $p.ProcessName
    $d['title'] = $p.MainWindowTitle
    $d['x'] = $rect.Left
    $d['y'] = $rect.Top
    $d['width'] = $w
    $d['height'] = $ht
    $d['isForeground'] = ($h -eq $fg)
    $d['isMinimized'] = [RobDevWin32]::IsIconic($h)
    $list.Add($d)
  }
}
Write-Output (ConvertTo-Json -InputObject @($list) -Compress -Depth 4)
`.trim();

    const res = await executeShellCommand({
      command: script,
      shell: 'powershell',
      cwd: process.cwd(),
      timeoutMs: 10_000,
    });

    if (!res.ok || !res.stdout) return [];
    try {
      const line = res.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.startsWith('[') || l.startsWith('{'));
      if (!line) return [];
      const parsed = JSON.parse(line);
      return Array.isArray(parsed)
        ? (parsed as WindowSummary[])
        : [parsed as WindowSummary];
    } catch {
      return [];
    }
  }

  /**
   * Focuses, maximizes, minimizes, launches, or closes a window on the Main PC.
   */
  async controlWindow(params: {
    action: 'list' | 'focus' | 'maximize' | 'minimize' | 'launch' | 'close';
    match?: string;
    args?: string[];
  }): Promise<{
    ok: boolean;
    action: string;
    matchedWindow?: WindowSummary | null;
    windows?: WindowSummary[];
    message: string;
  }> {
    if (params.action === 'list') {
      const windows = await this.listWindows();
      return {
        ok: true,
        action: 'list',
        windows,
        message: `Found ${windows.length} visible window(s).`,
      };
    }

    if (params.action === 'launch') {
      const targetExe = (params.match ?? '').trim();
      if (!targetExe) {
        return {
          ok: false,
          action: 'launch',
          message: 'Missing `match` executable path or URI to launch.',
        };
      }
      const argList = (params.args ?? [])
        .map((a) => `'${a.replace(/'/g, "''")}'`)
        .join(', ');
      const launchCmd = argList
        ? `Start-Process -FilePath '${targetExe.replace(/'/g, "''")}' -ArgumentList @(${argList}) -PassThru | Select-Object Id, ProcessName | ConvertTo-Json -Compress`
        : `Start-Process -FilePath '${targetExe.replace(/'/g, "''")}' -PassThru | Select-Object Id, ProcessName | ConvertTo-Json -Compress`;

      const res = await executeShellCommand({
        command: launchCmd,
        shell: 'powershell',
        cwd: process.cwd(),
        timeoutMs: 12_000,
      });

      return {
        ok: res.ok,
        action: 'launch',
        message: res.ok
          ? `Launched "${targetExe}" (${res.stdout || 'started'})`
          : `Failed to launch "${targetExe}": ${res.stderr || res.stdout}`,
      };
    }

    const needle = (params.match ?? '').trim().toLowerCase();
    const windows = await this.listWindows();
    const targetWin =
      windows.find(
        (w) =>
          w.title.toLowerCase().includes(needle) ||
          w.processName.toLowerCase().includes(needle),
      ) ?? null;

    if (!targetWin) {
      return {
        ok: false,
        action: params.action,
        matchedWindow: null,
        windows,
        message: `No visible window matching "${params.match ?? ''}" was found.`,
      };
    }

    const swCode =
      params.action === 'maximize'
        ? 3 // SW_MAXIMIZE
        : params.action === 'minimize'
          ? 6 // SW_MINIMIZE
          : 9; // SW_RESTORE

    const script =
      params.action === 'close'
        ? `Stop-Process -Id ${targetWin.pid} -Force -ErrorAction SilentlyContinue; Write-Output "CLOSED"`
        : `
Add-Type -TypeDefinition @'
${WIN32_CSHARP_HELPER}
'@ -ReferencedAssemblies System.Drawing, System.Windows.Forms -ErrorAction SilentlyContinue
$h = [IntPtr]::new(${targetWin.hwnd})
[RobDevWin32]::ShowWindow($h, ${swCode}) | Out-Null
[RobDevWin32]::SetForegroundWindow($h) | Out-Null
Write-Output "OK"
`.trim();

    const res = await executeShellCommand({
      command: script,
      shell: 'powershell',
      cwd: process.cwd(),
      timeoutMs: 8_000,
    });

    return {
      ok: res.ok,
      action: params.action,
      matchedWindow: targetWin,
      message: `${params.action} on window "${targetWin.title}" (${targetWin.processName}, PID ${targetWin.pid}).`,
    };
  }

  /**
   * Captures a screenshot of the Main PC (either a specific window or the full screen),
   * extracts clickable UI Automation elements, draws Set-of-Marks badges + cursor crosshair,
   * and stores the image in the Studio Media Library (`MediaFile`) and `/workspace/<studioSlug>/Screenshots/`.
   */
  async observeMainPc(params: {
    studioId: string;
    studioSlug: string;
    prisma: PrismaService;
    target?: string;
    annotate?: boolean;
    maxElements?: number;
  }): Promise<ScreenObservationResult> {
    const { studioWorkspaceRoot } = getWorkspaceRoots(params.studioSlug);
    const screenshotsDir = path.join(studioWorkspaceRoot, 'Screenshots');
    await fs.mkdir(screenshotsDir, { recursive: true });

    const fileName = `pc_observe_${Date.now()}.png`;
    const absPngPath = path.join(screenshotsDir, fileName);
    const escapedPngPath = absPngPath.replace(/'/g, "''");
    const targetNeedle = (params.target ?? 'foreground').trim();
    const escapedTarget = targetNeedle.replace(/'/g, "''");
    const maxEl = Math.min(150, Math.max(0, params.maxElements ?? 60));
    const annotate = params.annotate !== false;

    const psScript = `
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
${WIN32_CSHARP_HELPER}
'@ -ReferencedAssemblies System.Drawing, System.Windows.Forms -ErrorAction SilentlyContinue

[RobDevWin32]::SetProcessDPIAware() | Out-Null

$targetStr = '${escapedTarget}'
$targetHwnd = [IntPtr]::Zero
$winTitle = 'Desktop Screen'

if ($targetStr -ne 'screen' -and $targetStr -ne 'desktop') {
  if ($targetStr -eq 'foreground' -or $targetStr -eq '') {
    $targetHwnd = [RobDevWin32]::GetForegroundWindow()
  } else {
    $procs = Get-Process | Where-Object {
      $_.MainWindowHandle -ne 0 -and (
        $_.MainWindowTitle -like "*$targetStr*" -or
        $_.ProcessName -like "*$targetStr*"
      )
    } | Select-Object -First 1
    if ($procs) {
      $targetHwnd = $procs.MainWindowHandle
      $winTitle = $procs.MainWindowTitle
      if ([RobDevWin32]::IsIconic($targetHwnd)) {
        [RobDevWin32]::ShowWindow($targetHwnd, 9) | Out-Null
      }
      [RobDevWin32]::SetForegroundWindow($targetHwnd) | Out-Null
      Start-Sleep -Milliseconds 120
    }
  }
}

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$originX = $bounds.X
$originY = $bounds.Y
$width = $bounds.Width
$height = $bounds.Height

if ($targetHwnd -ne [IntPtr]::Zero) {
  $rect = New-Object RobDevWin32+RECT
  if ([RobDevWin32]::GetWindowRect($targetHwnd, [ref]$rect)) {
    $rw = $rect.Right - $rect.Left
    $rh = $rect.Bottom - $rect.Top
    if ($rw -gt 100 -and $rh -gt 100) {
      $originX = [Math]::Max(0, $rect.Left)
      $originY = [Math]::Max(0, $rect.Top)
      $width = [Math]::Min($bounds.Width - $originX, $rw)
      $height = [Math]::Min($bounds.Height - $originY, $rh)
    }
  }
  $sb = New-Object System.Text.StringBuilder 256
  [RobDevWin32]::GetWindowText($targetHwnd, $sb, 256) | Out-Null
  if ($sb.Length -gt 0) { $winTitle = $sb.ToString() }
}

$bmp = New-Object System.Drawing.Bitmap($width, $height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($originX, $originY, 0, 0, (New-Object System.Drawing.Size($width, $height)))

# Save raw screenshot immediately so it exists on disk even if UIA inspection takes time
$bmp.Save('${escapedPngPath}', [System.Drawing.Imaging.ImageFormat]::Png)

# Collect clickable UIA elements inside the captured region using a bounded BFS walk (avoid hanging on huge DOMs)
$elements = New-Object System.Collections.Generic.List[Object]
try {
  $rootEl = if ($targetHwnd -ne [IntPtr]::Zero) {
    [System.Windows.Automation.AutomationElement]::FromHandle($targetHwnd)
  } else {
    [System.Windows.Automation.AutomationElement]::RootElement
  }
  if ($rootEl -ne $null -and ${maxEl} -gt 0) {
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $queue = New-Object System.Collections.Generic.Queue[System.Windows.Automation.AutomationElement]
    $firstChild = $walker.GetFirstChild($rootEl)
    while ($firstChild -ne $null) {
      $queue.Enqueue($firstChild)
      $firstChild = $walker.GetNextSibling($firstChild)
    }
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $visited = 0
    $idx = 1
    while ($queue.Count -gt 0 -and $idx -le ${maxEl} -and $visited -lt 180 -and $sw.ElapsedMilliseconds -lt 850) {
      $el = $queue.Dequeue()
      $visited += 1
      try {
        if ($queue.Count -lt 240 -and $sw.ElapsedMilliseconds -lt 700) {
          $child = $walker.GetFirstChild($el)
          $childCount = 0
          while ($child -ne $null -and $childCount -lt 25) {
            $queue.Enqueue($child)
            $child = $walker.GetNextSibling($child)
            $childCount += 1
          }
        }
        $cur = $el.Current
        if ($cur.IsOffscreen -or -not $cur.IsEnabled) { continue }
        $ct = $cur.ControlType.ProgrammaticName -replace '^ControlType\\.', ''
        if ($ct -notin @('Button','TabItem','MenuItem','Edit','TreeItem','ListItem','CheckBox','RadioButton','ComboBox','Hyperlink','Document','Pane','Window')) {
          continue
        }
        $nm = ($cur.Name -replace '\\s+', ' ').Trim()
        if ([string]::IsNullOrEmpty($nm) -and $ct -notin @('Edit','Document')) { continue }
        $r = $cur.BoundingRectangle
        if ([double]::IsInfinity($r.Width) -or $r.Width -lt 8 -or $r.Height -lt 8 -or $r.Width -gt 1600) { continue }
        $ex = [int]$r.X
        $ey = [int]$r.Y
        $ew = [int]$r.Width
        $eh = [int]$r.Height
        $cx = [int]($ex + ($ew / 2))
        $cy = [int]($ey + ($eh / 2))
        if ($cx -lt $originX -or $cy -lt $originY -or $cx -gt ($originX + $width) -or $cy -gt ($originY + $height)) { continue }

        $elements.Add(@{
          id = $idx
          name = if ($nm.Length -gt 80) { $nm.Substring(0, 80) } else { $nm }
          controlType = $ct
          x = $ex
          y = $ey
          width = $ew
          height = $eh
          centerX = $cx
          centerY = $cy
        })

        if ($${annotate ? 'true' : 'false'}) {
          $relX = $ex - $originX
          $relY = $ey - $originY
          $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(210, 16, 185, 129), 2)
          $g.DrawRectangle($pen, $relX, $relY, $ew, $eh)
          $badgeBg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(230, 15, 23, 42))
          $font = New-Object System.Drawing.Font('Arial', 9, [System.Drawing.FontStyle]::Bold)
          $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 52, 211, 153))
          $g.FillRectangle($badgeBg, $relX, [Math]::Max(0, $relY - 16), 26, 16)
          $g.DrawString("#$idx", $font, $textBrush, $relX + 2, [Math]::Max(0, $relY - 16))
        }
        $idx += 1
      } catch {}
    }
  }
} catch {}

# Draw current cursor crosshair
$pt = New-Object RobDevWin32+POINT
[RobDevWin32]::GetCursorPos([ref]$pt) | Out-Null
$curRelX = $pt.X - $originX
$curRelY = $pt.Y - $originY
if ($curRelX -ge 0 -and $curRelY -ge 0 -and $curRelX -le $width -and $curRelY -le $height) {
  $redPen = New-Object System.Drawing.Pen([System.Drawing.Color]::Red, 2)
  $g.DrawEllipse($redPen, $curRelX - 8, $curRelY - 8, 16, 16)
  $g.DrawLine($redPen, $curRelX - 12, $curRelY, $curRelX + 12, $curRelY)
  $g.DrawLine($redPen, $curRelX, $curRelY - 12, $curRelX, $curRelY + 12)
}

$g.Dispose()
$bmp.Save('${escapedPngPath}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

$openWindows = [RobDevWin32]::GetVisibleWindows()
if ($winTitle -eq 'Desktop Screen' -and $openWindows.Count -gt 0) {
  $fgWin = $openWindows | Where-Object { $_['isForeground'] -eq $true } | Select-Object -First 1
  if ($fgWin -and $fgWin['title']) {
    $winTitle = [string]$fgWin['title']
  }
}

$idle = [RobDevWin32]::GetIdleSeconds()
$stop = [RobDevWin32]::IsCtrlShiftDeleteDown()

Write-Output (@{
  ok = $true
  windowTitle = $winTitle
  originX = $originX
  originY = $originY
  width = $width
  height = $height
  cursorX = $pt.X
  cursorY = $pt.Y
  idleSeconds = [Math]::Round($idle, 2)
  ctrlShiftDeletePressed = $stop
  elements = $elements
  openWindows = $openWindows
} | ConvertTo-Json -Compress -Depth 5)
`.trim();

    const execRes = await executeShellCommand({
      command: psScript,
      shell: 'powershell',
      cwd: studioWorkspaceRoot,
      timeoutMs: 15_000,
    });

    let windowTitle = 'Desktop Screen';
    let originX = 0;
    let originY = 0;
    let width = 1920;
    let height = 1080;
    let cursorX = 0;
    let cursorY = 0;
    let idleSeconds = 0;
    let ctrlShiftDeletePressed = false;
    let elements: UiAutomationElement[] = [];
    let openWindows: WindowSummary[] = [];

    if (execRes.stdout) {
      const jsonLine = execRes.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.startsWith('{'));
      if (jsonLine) {
        try {
          const parsed = JSON.parse(jsonLine) as Partial<ScreenObservationResult>;
          windowTitle = parsed.windowTitle ?? windowTitle;
          originX = parsed.originX ?? 0;
          originY = parsed.originY ?? 0;
          width = parsed.width ?? 1920;
          height = parsed.height ?? 1080;
          cursorX = parsed.cursorX ?? 0;
          cursorY = parsed.cursorY ?? 0;
          idleSeconds = parsed.idleSeconds ?? 0;
          ctrlShiftDeletePressed = Boolean(parsed.ctrlShiftDeletePressed);
          if (Array.isArray(parsed.elements)) {
            elements = parsed.elements;
          }
          if (Array.isArray(parsed.openWindows)) {
            openWindows = parsed.openWindows;
          }
        } catch {
          // ignore
        }
      }
    }

    this.lastMainPcObservation.set(params.studioId, {
      timestamp: Date.now(),
      originX,
      originY,
      width,
      height,
      elements,
    });

    const savedImage = await this.persistScreenshotMedia({
      prisma: params.prisma,
      studioId: params.studioId,
      absPngPath,
      width,
      height,
    });

    const openWindowsLines =
      openWindows.length > 0
        ? [
            `Open Windows (${openWindows.length}):`,
            ...openWindows.map(
              (w, i) =>
                `  ${i + 1}. ${w.isForeground ? '[FOREGROUND] ' : ''}"${w.title}" (${w.processName}, PID ${w.pid}) [${w.width}x${w.height} at (${w.x},${w.y})]${w.isMinimized ? ' [Minimized]' : ''}`,
            ),
          ]
        : [];
    const elementLines =
      elements.length > 0
        ? [
            `Interactive UI Elements (${elements.length}):`,
            ...elements.map(
              (e) => `[#${e.id} ${e.controlType}] "${e.name}" at (${e.centerX}, ${e.centerY})`,
            ),
          ]
        : [];
    const ocrSummary = [
      `Captured Target: "${windowTitle}" (${width}x${height} at (${originX},${originY}))`,
      ...openWindowsLines,
      ...elementLines,
    ].join('\n');

    return {
      ok: true,
      targetEnv: 'MAIN_PC',
      target: targetNeedle,
      windowTitle,
      originX,
      originY,
      width,
      height,
      cursorX,
      cursorY,
      idleSeconds,
      ctrlShiftDeletePressed,
      elements,
      openWindows,
      ocrText: ocrSummary,
      screenshotPath: absPngPath,
      ...(savedImage?.mediaId ? { mediaId: savedImage.mediaId } : {}),
      ...(savedImage ? { image: savedImage } : {}),
    };
  }

  /**
   * Resolves a `PcTarget` (`elementId`, `text`, or `(x, y)` in `screenshot` / `window` / `screen` space)
   * into physical screen coordinates `(x, y)`.
   */
  resolveTargetCoordinates(
    studioId: string,
    target: PcTarget | undefined,
    elements: UiAutomationElement[],
  ): { x: number; y: number; matchedLabel?: string } | null {
    if (!target) return null;

    if (target.elementId !== undefined) {
      const el = elements.find((e) => e.id === target.elementId);
      if (el) {
        return {
          x: el.centerX,
          y: el.centerY,
          matchedLabel: `#${el.id} (${el.name || el.controlType})`,
        };
      }
    }

    if (target.text) {
      const lower = target.text.toLowerCase();
      const el = elements.find((e) => e.name.toLowerCase().includes(lower));
      if (el) {
        return {
          x: el.centerX,
          y: el.centerY,
          matchedLabel: `#${el.id} ("${el.name}")`,
        };
      }
    }

    if (typeof target.x === 'number' && typeof target.y === 'number') {
      const obs = this.lastMainPcObservation.get(studioId);
      if (
        (target.space === 'screenshot' || target.space === 'window') &&
        obs
      ) {
        return {
          x: Math.round(obs.originX + target.x),
          y: Math.round(obs.originY + target.y),
        };
      }
      return {
        x: Math.round(target.x),
        y: Math.round(target.y),
      };
    }

    return null;
  }

  /**
   * Executes a batch of up to 20 mouse & keyboard steps (`pc_act`) on the Main PC,
   * checking for `Ctrl + Shift + Delete` before every step and optionally capturing a fresh screenshot after.
   */
  async executeMainPcSteps(params: {
    studioId: string;
    studioSlug: string;
    prisma: PrismaService;
    window?: string;
    steps: PcStep[];
    observeAfter?: boolean;
    settleMs?: number;
  }): Promise<{
    ok: boolean;
    completedSteps: Array<{ index: number; type: string; detail: string }>;
    stoppedByHotkey?: boolean;
    failedStep?: { index: number; type: string; error: string };
    observation?: ScreenObservationResult;
  }> {
    if (params.window) {
      await this.controlWindow({ action: 'focus', match: params.window });
    }

    const cached = this.lastMainPcObservation.get(params.studioId);
    let currentElements = cached?.elements ?? [];
    if (currentElements.length === 0) {
      const initialObs = await this.observeMainPc({
        studioId: params.studioId,
        studioSlug: params.studioSlug,
        prisma: params.prisma,
        target: params.window || 'foreground',
        annotate: false,
        maxElements: 60,
      });
      currentElements = initialObs.elements;
    }

    const completedSteps: Array<{ index: number; type: string; detail: string }> = [];

    for (let idx = 0; idx < params.steps.length; idx++) {
      const step = params.steps[idx]!;

      // Check Ctrl + Shift + Delete kill switch before every step
      const state = await this.getMainPcIdleAndHotkeyState();
      if (state.ctrlShiftDeletePressed || state.emergencyStopped) {
        return {
          ok: false,
          completedSteps,
          stoppedByHotkey: true,
          failedStep: {
            index: idx,
            type: step.type,
            error: 'Stopped immediately: Operator pressed Ctrl + Shift + Delete.',
          },
        };
      }

      if (step.type === 'wait') {
        const ms = Math.min(15_000, Math.max(50, step.ms ?? 500));
        await new Promise((r) => setTimeout(r, ms));
        completedSteps.push({ index: idx, type: 'wait', detail: `Waited ${ms}ms` });
        continue;
      }

      if (step.type === 'focus_window') {
        const res = await this.controlWindow({
          action: 'focus',
          match: step.match ?? params.window ?? 'Roblox Studio',
        });
        completedSteps.push({
          index: idx,
          type: 'focus_window',
          detail: res.message,
        });
        continue;
      }

      if (step.type === 'wait_for') {
        const timeoutMs = Math.min(30_000, Math.max(500, step.timeoutMs ?? 8_000));
        const deadline = Date.now() + timeoutMs;
        let matched = false;
        while (Date.now() < deadline) {
          const obs = await this.observeMainPc({
            studioId: params.studioId,
            studioSlug: params.studioSlug,
            prisma: params.prisma,
            target: params.window || 'foreground',
            annotate: false,
            maxElements: 60,
          });
          currentElements = obs.elements;
          const cond = step.condition;
          const hasText = cond?.text
            ? obs.ocrText.toLowerCase().includes(cond.text.toLowerCase()) ||
              obs.windowTitle.toLowerCase().includes(cond.text.toLowerCase())
            : true;
          const hasEl = cond?.elementName
            ? obs.elements.some((e) =>
                e.name.toLowerCase().includes(cond.elementName!.toLowerCase()),
              )
            : true;
          const hasWin = cond?.windowTitle
            ? obs.windowTitle.toLowerCase().includes(cond.windowTitle.toLowerCase())
            : true;
          const rawMatch = hasText && hasEl && hasWin;
          if (cond?.gone ? !rawMatch : rawMatch) {
            matched = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 400));
        }
        completedSteps.push({
          index: idx,
          type: 'wait_for',
          detail: matched
            ? `Condition met: ${JSON.stringify(step.condition)}`
            : `Timed out waiting (${timeoutMs}ms) for ${JSON.stringify(step.condition)}`,
        });
        continue;
      }

      if (
        step.type === 'click' ||
        step.type === 'double_click' ||
        step.type === 'right_click' ||
        step.type === 'move'
      ) {
        const coords = this.resolveTargetCoordinates(
          params.studioId,
          step.target,
          currentElements,
        );
        if (!coords) {
          return {
            ok: false,
            completedSteps,
            failedStep: {
              index: idx,
              type: step.type,
              error: `Could not resolve target coordinates for ${JSON.stringify(step.target)}`,
            },
          };
        }

        const btn =
          step.type === 'right_click' ? 'right' : (step.button ?? 'left');
        const count =
          step.type === 'double_click' ? 2 : (step.count ?? 1);

        const ps = `
Add-Type -TypeDefinition @'
${WIN32_CSHARP_HELPER}
'@ -ReferencedAssemblies System.Drawing, System.Windows.Forms -ErrorAction SilentlyContinue
[RobDevWin32]::SetProcessDPIAware() | Out-Null
${
  step.type === 'move'
    ? `[RobDevWin32]::SetCursorPos(${coords.x}, ${coords.y}) | Out-Null`
    : `[RobDevWin32]::ClickAt(${coords.x}, ${coords.y}, '${btn}', ${count})`
}
Write-Output "OK"
`.trim();

        await executeShellCommand({
          command: ps,
          shell: 'powershell',
          cwd: process.cwd(),
          timeoutMs: 8_000,
        });

        completedSteps.push({
          index: idx,
          type: step.type,
          detail: `${step.type} (${btn} x${count}) at (${coords.x}, ${coords.y})${coords.matchedLabel ? ` [${coords.matchedLabel}]` : ''}`,
        });
        continue;
      }

      if (step.type === 'drag') {
        const fromCoords = this.resolveTargetCoordinates(
          params.studioId,
          step.from ?? step.target,
          currentElements,
        );
        const toCoords = this.resolveTargetCoordinates(
          params.studioId,
          step.to,
          currentElements,
        );
        if (!fromCoords || !toCoords) {
          return {
            ok: false,
            completedSteps,
            failedStep: {
              index: idx,
              type: 'drag',
              error: 'Missing valid `from` or `to` coordinates for drag step.',
            },
          };
        }
        const btn = step.button ?? 'left';
        const ps = `
Add-Type -TypeDefinition @'
${WIN32_CSHARP_HELPER}
'@ -ReferencedAssemblies System.Drawing, System.Windows.Forms -ErrorAction SilentlyContinue
[RobDevWin32]::SetProcessDPIAware() | Out-Null
[RobDevWin32]::DragBetween(${fromCoords.x}, ${fromCoords.y}, ${toCoords.x}, ${toCoords.y}, '${btn}')
Write-Output "OK"
`.trim();
        await executeShellCommand({
          command: ps,
          shell: 'powershell',
          cwd: process.cwd(),
          timeoutMs: 10_000,
        });
        completedSteps.push({
          index: idx,
          type: 'drag',
          detail: `Dragged (${fromCoords.x}, ${fromCoords.y}) -> (${toCoords.x}, ${toCoords.y})`,
        });
        continue;
      }

      if (step.type === 'scroll') {
        const coords = this.resolveTargetCoordinates(
          params.studioId,
          step.target,
          currentElements,
        );
        const wheelDelta = (step.dy ?? -3) * 120;
        const ps = `
Add-Type -TypeDefinition @'
${WIN32_CSHARP_HELPER}
'@ -ReferencedAssemblies System.Drawing, System.Windows.Forms -ErrorAction SilentlyContinue
[RobDevWin32]::SetProcessDPIAware() | Out-Null
${coords ? `[RobDevWin32]::SetCursorPos(${coords.x}, ${coords.y}) | Out-Null` : ''}
[RobDevWin32]::mouse_event([RobDevWin32]::MOUSEEVENTF_WHEEL, 0, 0, [uint32]([int]${wheelDelta}), [UIntPtr]::Zero)
Write-Output "OK"
`.trim();
        await executeShellCommand({
          command: ps,
          shell: 'powershell',
          cwd: process.cwd(),
          timeoutMs: 8_000,
        });
        completedSteps.push({
          index: idx,
          type: 'scroll',
          detail: `Scrolled dy=${step.dy ?? -3}`,
        });
        continue;
      }

      if (step.type === 'mouse_look') {
        const dx = step.dx ?? 120;
        const dy = step.dy ?? 0;
        const holdRight = step.holdRight !== false;
        const ps = `
Add-Type -TypeDefinition @'
${WIN32_CSHARP_HELPER}
'@ -ReferencedAssemblies System.Drawing, System.Windows.Forms -ErrorAction SilentlyContinue
[RobDevWin32]::MouseLookRelative(${dx}, ${dy}, $${holdRight ? 'true' : 'false'})
Write-Output "OK"
`.trim();
        await executeShellCommand({
          command: ps,
          shell: 'powershell',
          cwd: process.cwd(),
          timeoutMs: 8_000,
        });
        completedSteps.push({
          index: idx,
          type: 'mouse_look',
          detail: `Rotated camera dx=${dx}, dy=${dy}`,
        });
        continue;
      }

      if (step.type === 'type') {
        const textToType = step.text ?? '';
        const b64 = Buffer.from(textToType, 'utf8').toString('base64');
        const ps = `
Add-Type -AssemblyName System.Windows.Forms
$txt = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b64}'))
[System.Windows.Forms.Clipboard]::SetText($txt)
Start-Sleep -Milliseconds 40
[System.Windows.Forms.SendKeys]::SendWait('^v')
Write-Output "OK"
`.trim();
        await executeShellCommand({
          command: ps,
          shell: 'powershell',
          cwd: process.cwd(),
          timeoutMs: 8_000,
        });
        completedSteps.push({
          index: idx,
          type: 'type',
          detail: `Typed ${textToType.length} chars`,
        });
        continue;
      }

      if (step.type === 'hotkey' || step.type === 'key_hold') {
        const keys =
          step.type === 'key_hold'
            ? [step.key ?? 'W']
            : (step.keys ?? (step.key ? [step.key] : ['Enter']));
        const holdMs =
          step.type === 'key_hold'
            ? Math.min(10_000, Math.max(50, step.ms ?? 600))
            : 45;
        const vks = keys.map((k) => this.mapKeyNameToVk(k));
        const ps = `
Add-Type -TypeDefinition @'
${WIN32_CSHARP_HELPER}
'@ -ReferencedAssemblies System.Drawing, System.Windows.Forms -ErrorAction SilentlyContinue
$vks = @(${vks.join(', ')})
foreach ($vk in $vks) { [RobDevWin32]::SendHardwareKey([byte]$vk, $true); Start-Sleep -Milliseconds 15 }
Start-Sleep -Milliseconds ${holdMs}
for ($i = $vks.Length - 1; $i -ge 0; $i--) { [RobDevWin32]::SendHardwareKey([byte]$vks[$i], $false); Start-Sleep -Milliseconds 15 }
Write-Output "OK"
`.trim();
        await executeShellCommand({
          command: ps,
          shell: 'powershell',
          cwd: process.cwd(),
          timeoutMs: holdMs + 8_000,
        });
        completedSteps.push({
          index: idx,
          type: step.type,
          detail: `${step.type}: ${keys.join('+')} (${holdMs}ms)`,
        });
        continue;
      }
    }

    if ((params.settleMs ?? 400) > 0) {
      await new Promise((r) =>
        setTimeout(r, Math.min(5_000, params.settleMs ?? 400)),
      );
    }

    let observation: ScreenObservationResult | undefined;
    if (params.observeAfter !== false) {
      observation = await this.observeMainPc({
        studioId: params.studioId,
        studioSlug: params.studioSlug,
        prisma: params.prisma,
        target: params.window || 'foreground',
        annotate: true,
        maxElements: 60,
      });
    }

    return {
      ok: true,
      completedSteps,
      ...(observation ? { observation } : {}),
    };
  }

  /**
   * Ensures an isolated Sandbox exists for the given agent (up to 15 concurrent sandboxes, 1 per agent,
   * running locally or connected to a Cloud GPU / Dedicated VM service).
   */
  async ensureAgentSandbox(params: {
    studioId: string;
    studioSlug: string;
    agentKey: AgentKey;
    provider?: SandboxProviderKind;
    cloudEndpoint?: string;
    maxConcurrent?: number;
  }): Promise<AgentSandboxInstance> {
    const mapKey = `${params.studioId}::${params.agentKey}`;
    const existing = this.sandboxes.get(mapKey);
    if (existing && existing.status !== 'STOPPED') {
      existing.lastActiveAt = new Date().toISOString();
      return existing;
    }

    const activeForStudio = Array.from(this.sandboxes.values()).filter(
      (s) => s.studioId === params.studioId && s.status !== 'STOPPED',
    );
    const limit = Math.min(15, Math.max(1, params.maxConcurrent ?? 15));

    // If at limit, evict the lowest-priority or oldest sandbox
    if (activeForStudio.length >= limit) {
      activeForStudio.sort(
        (a, b) =>
          this.getAgentPriority(a.agentKey) - this.getAgentPriority(b.agentKey),
      );
      const victim = activeForStudio[0];
      if (victim) {
        await victim.browserContext?.close().catch(() => {});
        this.sandboxes.delete(`${victim.studioId}::${victim.agentKey}`);
      }
    }

    const { studioWorkspaceRoot } = getWorkspaceRoots(params.studioSlug);
    const sandboxDir = path.join(
      studioWorkspaceRoot,
      '.sandboxes',
      params.agentKey,
    );
    await fs.mkdir(sandboxDir, { recursive: true });

    const provider: SandboxProviderKind = params.provider ?? 'LOCAL';
    let browserContext: BrowserContext | undefined;
    let page: Page | undefined;

    if (provider === 'LOCAL') {
      const profileDir = path.join(sandboxDir, 'browser-profile');
      await fs.mkdir(profileDir, { recursive: true });
      browserContext = await chromium
        .launchPersistentContext(profileDir, {
          headless: true,
          viewport: { width: 1280, height: 720 },
        })
        .catch(() => undefined);
      page = browserContext?.pages()[0] ?? (await browserContext?.newPage());
    }

    const now = new Date().toISOString();
    const instance: AgentSandboxInstance = {
      agentKey: params.agentKey,
      studioId: params.studioId,
      provider,
      workspaceDir: sandboxDir,
      createdAt: now,
      lastActiveAt: now,
      status: 'READY',
      cloudEndpoint: params.cloudEndpoint ?? null,
      currentUrl: page ? page.url() : null,
      viewport: { width: 1280, height: 720 },
      browserContext,
      page,
      lastElements: [],
    };

    this.sandboxes.set(mapKey, instance);
    return instance;
  }

  listStudioSandboxes(studioId: string): Array<{
    agentKey: AgentKey;
    priority: number;
    provider: SandboxProviderKind;
    workspaceDir: string;
    status: string;
    currentUrl: string | null;
    cloudEndpoint: string | null;
    createdAt: string;
    lastActiveAt: string;
  }> {
    return Array.from(this.sandboxes.values())
      .filter((s) => s.studioId === studioId && s.status !== 'STOPPED')
      .map((s) => ({
        agentKey: s.agentKey,
        priority: this.getAgentPriority(s.agentKey),
        provider: s.provider,
        workspaceDir: s.workspaceDir,
        status: s.status,
        currentUrl: s.currentUrl,
        cloudEndpoint: s.cloudEndpoint,
        createdAt: s.createdAt,
        lastActiveAt: s.lastActiveAt,
      }))
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Observes an agent's dedicated Sandbox (captures screenshot + interactive DOM/UI elements).
   */
  async observeSandbox(params: {
    studioId: string;
    studioSlug: string;
    agentKey: AgentKey;
    prisma: PrismaService;
  }): Promise<ScreenObservationResult> {
    const sb = await this.ensureAgentSandbox({
      studioId: params.studioId,
      studioSlug: params.studioSlug,
      agentKey: params.agentKey,
    });

    const screenshotsDir = path.join(sb.workspaceDir, 'Screenshots');
    await fs.mkdir(screenshotsDir, { recursive: true });
    const absPngPath = path.join(
      screenshotsDir,
      `sandbox_${params.agentKey}_${Date.now()}.png`,
    );

    let elements: UiAutomationElement[] = [];
    let title = `Sandbox (${params.agentKey})`;

    if (sb.page) {
      title = (await sb.page.title().catch(() => '')) || sb.page.url() || title;
      elements = await sb.page
        .evaluate(() => {
          const doc = (globalThis as unknown as {
            document?: {
              querySelectorAll: (sel: string) => ArrayLike<{
                tagName: string;
                innerText?: string;
                value?: string;
                getAttribute: (n: string) => string | null;
                getBoundingClientRect: () => {
                  left: number;
                  top: number;
                  width: number;
                  height: number;
                };
              }>;
            };
          }).document;
          if (!doc) return [];
          const nodes = Array.from(
            doc.querySelectorAll(
              'button, a, input, textarea, select, [role="button"], [tabindex]',
            ),
          );
          const out: UiAutomationElement[] = [];
          let id = 1;
          for (const el of nodes) {
            if (id > 60) break;
            const r = el.getBoundingClientRect();
            if (r.width < 6 || r.height < 6) continue;
            const name = (
              el.innerText ||
              el.value ||
              el.getAttribute('aria-label') ||
              el.getAttribute('placeholder') ||
              el.tagName
            )
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 80);
            out.push({
              id,
              name,
              controlType: el.tagName.toLowerCase(),
              x: Math.round(r.left),
              y: Math.round(r.top),
              width: Math.round(r.width),
              height: Math.round(r.height),
              centerX: Math.round(r.left + r.width / 2),
              centerY: Math.round(r.top + r.height / 2),
            });
            id++;
          }
          return out;
        })
        .catch(() => []);

      await sb.page.screenshot({ path: absPngPath }).catch(() => {});
      sb.lastElements = elements;
    }

    const savedImage = await this.persistScreenshotMedia({
      prisma: params.prisma,
      studioId: params.studioId,
      absPngPath,
      width: sb.viewport.width,
      height: sb.viewport.height,
    });

    return {
      ok: true,
      targetEnv: 'SANDBOX',
      target: `sandbox:${params.agentKey}`,
      windowTitle: title,
      originX: 0,
      originY: 0,
      width: sb.viewport.width,
      height: sb.viewport.height,
      cursorX: 0,
      cursorY: 0,
      idleSeconds: 0,
      ctrlShiftDeletePressed: false,
      elements,
      ocrText: elements
        .map((e) => `[#${e.id} ${e.controlType}] "${e.name}" at (${e.centerX}, ${e.centerY})`)
        .join('\n'),
      screenshotPath: absPngPath,
      ...(savedImage?.mediaId ? { mediaId: savedImage.mediaId } : {}),
      ...(savedImage ? { image: savedImage } : {}),
    };
  }

  /**
   * Executes steps inside the agent's isolated Sandbox.
   */
  async executeSandboxSteps(params: {
    studioId: string;
    studioSlug: string;
    agentKey: AgentKey;
    prisma: PrismaService;
    steps: PcStep[];
    observeAfter?: boolean;
  }): Promise<{
    ok: boolean;
    completedSteps: Array<{ index: number; type: string; detail: string }>;
    observation?: ScreenObservationResult;
  }> {
    const sb = await this.ensureAgentSandbox({
      studioId: params.studioId,
      studioSlug: params.studioSlug,
      agentKey: params.agentKey,
    });

    const completedSteps: Array<{ index: number; type: string; detail: string }> = [];

    for (let idx = 0; idx < params.steps.length; idx++) {
      const step = params.steps[idx]!;
      if (!sb.page) break;

      if (step.type === 'wait') {
        await sb.page.waitForTimeout(Math.min(10_000, step.ms ?? 400));
        completedSteps.push({
          index: idx,
          type: 'wait',
          detail: `Waited ${step.ms ?? 400}ms in sandbox`,
        });
        continue;
      }

      if (
        step.type === 'click' ||
        step.type === 'double_click' ||
        step.type === 'right_click' ||
        step.type === 'move'
      ) {
        const t = step.target;
        let x = t?.x ?? 640;
        let y = t?.y ?? 360;
        if (t?.elementId !== undefined) {
          const found = sb.lastElements.find((e) => e.id === t.elementId);
          if (found) {
            x = found.centerX;
            y = found.centerY;
          }
        } else if (t?.text) {
          const found = sb.lastElements.find((e) =>
            e.name.toLowerCase().includes(t.text!.toLowerCase()),
          );
          if (found) {
            x = found.centerX;
            y = found.centerY;
          }
        }
        if (step.type === 'move') {
          await sb.page.mouse.move(x, y);
        } else {
          await sb.page.mouse.click(x, y, {
            button: step.type === 'right_click' ? 'right' : (step.button ?? 'left'),
            clickCount: step.type === 'double_click' ? 2 : (step.count ?? 1),
          });
        }
        completedSteps.push({
          index: idx,
          type: step.type,
          detail: `Sandbox ${step.type} at (${x}, ${y})`,
        });
        continue;
      }

      if (step.type === 'type' && step.text) {
        await sb.page.keyboard.type(step.text);
        completedSteps.push({
          index: idx,
          type: 'type',
          detail: `Sandbox typed ${step.text.length} chars`,
        });
        continue;
      }

      if (step.type === 'hotkey' || step.type === 'key_hold') {
        const key = step.key ?? step.keys?.join('+') ?? 'Enter';
        await sb.page.keyboard.press(key);
        completedSteps.push({
          index: idx,
          type: step.type,
          detail: `Sandbox key press: ${key}`,
        });
      }
    }

    const observation =
      params.observeAfter !== false
        ? await this.observeSandbox({
            studioId: params.studioId,
            studioSlug: params.studioSlug,
            agentKey: params.agentKey,
            prisma: params.prisma,
          })
        : undefined;

    return {
      ok: true,
      completedSteps,
      ...(observation ? { observation } : {}),
    };
  }

  async destroyAgentSandbox(studioId: string, agentKey: AgentKey): Promise<boolean> {
    const key = `${studioId}::${agentKey}`;
    const existing = this.sandboxes.get(key);
    if (!existing) return false;
    existing.status = 'STOPPED';
    await existing.browserContext?.close().catch(() => {});
    this.sandboxes.delete(key);
    return true;
  }

  private async persistScreenshotMedia(params: {
    prisma: PrismaService;
    studioId: string;
    absPngPath: string;
    width: number;
    height: number;
  }): Promise<ToolResultImage | null> {
    try {
      const buf = await fs.readFile(params.absPngPath);
      const base64 = buf.toString('base64');
      const sha256 = createHash('sha256').update(buf).digest('hex');
      const storageKey = `screenshots/${params.studioId}/${path.basename(params.absPngPath)}`;

      // Copy to configured MEDIA_STORAGE_ROOT (default ./storage/media) so /api/media/:id serves it
      const configuredMediaRoot = path.resolve(
        process.env['MEDIA_STORAGE_ROOT'] || './storage/media',
      );
      const destPath = path.join(configuredMediaRoot, storageKey);
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.writeFile(destPath, buf);

      // Also copy to legacy backend/data/media for backwards compatibility
      const legacyMediaRoot = path.resolve(process.cwd(), 'data', 'media');
      if (legacyMediaRoot !== configuredMediaRoot) {
        const legacyDestPath = path.join(legacyMediaRoot, storageKey);
        await fs.mkdir(path.dirname(legacyDestPath), { recursive: true });
        await fs.writeFile(legacyDestPath, buf);
      }

      const mediaRow = await params.prisma.mediaFile
        ?.create?.({
          data: {
            studioId: params.studioId,
            storageKey,
            mimeType: 'image/png',
            width: params.width,
            height: params.height,
            bytes: buf.byteLength,
            sha256,
          },
          select: { id: true },
        })
        .catch(() => null);

      return {
        ...(mediaRow?.id ? { mediaId: mediaRow.id } : {}),
        mimeType: 'image/png',
        base64,
        filePath: params.absPngPath,
        width: params.width,
        height: params.height,
      };
    } catch {
      return null;
    }
  }

  private mapKeyNameToVk(rawKey: string): number {
    const k = rawKey.trim().toUpperCase();
    const map: Record<string, number> = {
      BACKSPACE: 0x08,
      TAB: 0x09,
      ENTER: 0x0d,
      RETURN: 0x0d,
      SHIFT: 0x10,
      CTRL: 0x11,
      CONTROL: 0x11,
      ALT: 0x12,
      MENU: 0x12,
      PAUSE: 0x13,
      CAPSLOCK: 0x14,
      ESC: 0x1b,
      ESCAPE: 0x1b,
      SPACE: 0x20,
      PAGEUP: 0x21,
      PAGEDOWN: 0x22,
      END: 0x23,
      HOME: 0x24,
      LEFT: 0x25,
      UP: 0x26,
      RIGHT: 0x27,
      DOWN: 0x28,
      INSERT: 0x2d,
      DELETE: 0x2e,
      DEL: 0x2e,
      WIN: 0x5b,
      LWIN: 0x5b,
      F1: 0x70,
      F2: 0x71,
      F3: 0x72,
      F4: 0x73,
      F5: 0x74,
      F6: 0x75,
      F7: 0x76,
      F8: 0x77,
      F9: 0x78,
      F10: 0x79,
      F11: 0x7a,
      F12: 0x7b,
    };
    if (map[k] !== undefined) return map[k]!;
    if (k.length === 1) {
      return k.charCodeAt(0);
    }
    return 0x0d;
  }
}
