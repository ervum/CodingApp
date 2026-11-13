import {
  ChangeDetectionStrategy,
  Component,
   type OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type {
  McpServerInfoDto,
  McpToolCallResultDto,
  McpToolCategory,
  McpToolDefinitionDto,
} from '@robdev/shared';
import { WebMcpBridgeService } from '../../core/mcp/web-mcp-bridge.service';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ToastService } from '../../shared/ui/toast/toast.service';

@Component({
  selector: 'rd-mcp-server-panel',
  standalone: true,
  imports: [FormsModule, IconComponent],
  templateUrl: './mcp-server-panel.component.html',
  styleUrl: './mcp-server-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class McpServerPanelComponent implements OnInit {
  readonly store = inject(StudioStoreService);
  readonly mcpBridge = inject(WebMcpBridgeService);
  private readonly toast = inject(ToastService);

  readonly loading = signal<boolean>(false);
  readonly info = signal<McpServerInfoDto | null>(null);
  readonly selectedCategory = signal<string>('ALL');
  readonly searchQuery = signal<string>('');

  // Quick Prompt Lead bar
  readonly quickLeadPrompt = signal<string>(
    'Give me a concise status update of the studio and our current games.',
  );
  readonly quickWaitForCompletion = signal<boolean>(false);
  readonly runningQuickLead = signal<boolean>(false);

  // Interactive Tool Playground
  readonly selectedToolName = signal<string>('prompt_lead');
  readonly toolArgsJson = signal<string>(
    JSON.stringify(
      {
        prompt: 'Give me a concise status update of the studio and our current games.',
        waitForCompletion: false,
      },
      null,
      2,
    ),
  );
  readonly runningTool = signal<boolean>(false);
  readonly lastToolResult = signal<McpToolCallResultDto | null>(null);
  readonly configTab = signal<'http' | 'stdio' | 'webmcp'>('http');

  readonly categories = computed<string[]>(() => {
    const tools = this.info()?.tools ?? [];
    const seen = new Set<McpToolCategory>();
    for (const t of tools) {
      seen.add(t.category);
    }
    return ['ALL', ...Array.from(seen)];
  });

  readonly filteredTools = computed<McpToolDefinitionDto[]>(() => {
    const tools = this.info()?.tools ?? [];
    const cat = this.selectedCategory();
    const q = this.searchQuery().trim().toLowerCase();
    return tools.filter((t) => {
      if (cat !== 'ALL' && t.category !== cat) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q)
      );
    });
  });

  readonly selectedTool = computed<McpToolDefinitionDto | null>(() => {
    const tools = this.info()?.tools ?? [];
    return tools.find((t) => t.name === this.selectedToolName()) ?? tools[0] ?? null;
  });

  readonly httpConfigSnippet = computed<string>(() => {
    const server = this.info();
    const url = server?.httpEndpoint ?? 'http://localhost:3000/api/mcp';
    return JSON.stringify(
      {
        mcpServers: {
          'robdev-control-room': {
            serverUrl: url,
          },
        },
      },
      null,
      2,
    );
  });

  readonly stdioConfigSnippet = computed<string>(() => {
    const server = this.info();
    return JSON.stringify(
      {
        mcpServers: {
          'robdev-control-room': {
            command: server?.stdioCommand ?? 'node',
            args: server?.stdioArgs ?? ['C:\\Dev\\App\\backend\\dist\\mcp-stdio.js'],
            env: {
              ROBDEV_MCP_URL: server?.httpEndpoint ?? 'http://localhost:3000/api/mcp',
            },
          },
        },
      },
      null,
      2,
    );
  });

  readonly webMcpSnippet = computed<string>(() => {
    return [
      '// Call any RobDev MCP tool directly from the browser console or Playwright/DevTools agent:',
      'await window.robdevMcp.promptLead("Design a new obby event update", { waitForCompletion: true });',
      '',
      '// Or invoke any of the 33 studio tools by name:',
      'await window.robdevMcp.callTool("get_studio_snapshot", {});',
      'await window.robdevMcp.callTool("answer_now", { agentKey: "lead" });',
    ].join('\n');
  });

  readonly formattedLastResult = computed<string>(() => {
    const res = this.lastToolResult();
    if (!res) return '';
    if (res.structuredContent !== undefined) {
      return JSON.stringify(res.structuredContent, null, 2);
    }
    return res.content.map((c) => c.text).join('\n');
  });

  ngOnInit(): void {
    void this.loadServerInfo();
  }

  async loadServerInfo(): Promise<void> {
    this.loading.set(true);
    try {
      await this.mcpBridge.init();
      const info = await window.robdevMcp!.getServerInfo();
      this.info.set(info);
      const currentTool = info.tools.find((t) => t.name === this.selectedToolName());
      if (currentTool) {
        this.toolArgsJson.set(JSON.stringify(currentTool.exampleArgs, null, 2));
      }
    } catch {
      this.toast.error('Failed to load MCP server metadata');
    } finally {
      this.loading.set(false);
    }
  }

  selectTool(tool: McpToolDefinitionDto): void {
    this.selectedToolName.set(tool.name);
    this.toolArgsJson.set(JSON.stringify(tool.exampleArgs ?? {}, null, 2));
  }

  async onQuickPromptLead(): Promise<void> {
    const prompt = this.quickLeadPrompt().trim();
    if (!prompt || this.runningQuickLead()) return;
    this.runningQuickLead.set(true);
    try {
      await this.mcpBridge.init();
      const res = await window.robdevMcp!.promptLead(prompt, {
        waitForCompletion: this.quickWaitForCompletion(),
      });
      this.lastToolResult.set(res);
      this.selectedToolName.set('prompt_lead');
      if (res.isError) {
        this.toast.error('MCP prompt_lead returned an error');
      } else {
        this.toast.success(
          this.quickWaitForCompletion()
            ? 'Lead completed MCP prompt'
            : 'Prompt sent to Lead via MCP',
        );
      }
    } catch {
      this.toast.error('Failed to call MCP prompt_lead tool');
    } finally {
      this.runningQuickLead.set(false);
    }
  }

  async executeSelectedTool(): Promise<void> {
    const tool = this.selectedTool();
    if (!tool || this.runningTool()) return;

    let parsedArgs: Record<string, unknown> = {};
    const raw = this.toolArgsJson().trim();
    if (raw) {
      try {
        parsedArgs = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        this.toast.error('Invalid JSON in Tool Arguments editor');
        return;
      }
    }

    this.runningTool.set(true);
    try {
      await this.mcpBridge.init();
      const res = await window.robdevMcp!.callTool(tool.name, parsedArgs);
      this.lastToolResult.set(res);
      if (res.isError) {
        this.toast.warning(`Tool "${tool.name}" returned an error (${res.durationMs}ms)`);
      } else {
        this.toast.success(`Executed "${tool.name}" (${res.durationMs}ms)`);
      }
    } catch {
      this.toast.error(`Failed to execute MCP tool "${tool.name}"`);
    } finally {
      this.runningTool.set(false);
    }
  }

  async copyText(text: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.toast.success(`Copied ${label} to clipboard`);
    } catch {
      this.toast.error('Clipboard access unavailable');
    }
  }
}
