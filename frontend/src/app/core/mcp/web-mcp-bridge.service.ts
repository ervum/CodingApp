import { Injectable, inject, signal } from '@angular/core';
import type {
  AgentKey,
  McpServerInfoDto,
  McpToolCallResultDto,
  McpToolDefinitionDto,
} from '@robdev/shared';
import { firstValueFrom } from 'rxjs';
import { McpApiService } from '../api/mcp-api.service';
import { StudioStoreService } from '../state/studio-store.service';

export interface RobdevPageMcpBridge {
  readonly version: string;
  getServerInfo: () => Promise<McpServerInfoDto>;
  listTools: () => Promise<McpToolDefinitionDto[]>;
  callTool: (
    toolName: string,
    args?: Record<string, unknown>,
  ) => Promise<McpToolCallResultDto>;
  promptLead: (
    prompt: string,
    options?: {
      waitForCompletion?: boolean;
      waitForSubtasks?: boolean;
      timeoutMs?: number;
      gameId?: string;
    },
  ) => Promise<McpToolCallResultDto>;
  promptAgent: (
    agentKey: AgentKey,
    prompt: string,
    options?: {
      waitForCompletion?: boolean;
      timeoutMs?: number;
      gameId?: string;
    },
  ) => Promise<McpToolCallResultDto>;
  answerNow: (agentKey?: AgentKey) => Promise<McpToolCallResultDto>;
  jsonRpc: (payload: Record<string, unknown>) => Promise<unknown>;
}

declare global {
  interface Window {
    robdevMcp?: RobdevPageMcpBridge;
  }
  interface Navigator {
    modelContext?: {
      registerTool?: (tool: {
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
        execute: (args: Record<string, unknown>) => Promise<unknown>;
      }) => void;
      provideContext?: (context: {
        tools: Array<{
          name: string;
          description: string;
          inputSchema: Record<string, unknown>;
          execute: (args: Record<string, unknown>) => Promise<unknown>;
        }>;
      }) => void;
    };
  }
}

const MUTATING_TOOLS = new Set<string>([
  'prompt_lead',
  'prompt_agent',
  'answer_now',
  'clear_agent_chat',
  'update_agent_config',
  'cancel_run',
  'set_studio_model',
  'set_browser_visibility',
  'delete_web_chats',
  'create_task',
  'cancel_task',
  'retry_task',
  'pause_or_resume_studio',
  'reply_human_request',
  'create_or_update_game',
  'manage_pitches',
  'vault_operations',
  'review_operations',
]);

@Injectable({ providedIn: 'root' })
export class WebMcpBridgeService {
  private readonly mcpApi = inject(McpApiService);
  private readonly store = inject(StudioStoreService);

  readonly serverInfo = signal<McpServerInfoDto | null>(null);
  readonly bridgeReady = signal<boolean>(false);
  readonly webMcpSupported = signal<boolean>(false);
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized || typeof window === 'undefined') return;
    this.initialized = true;

    const bridge: RobdevPageMcpBridge = {
      version: '1.0.0',
      getServerInfo: async () => {
        const info = await firstValueFrom(this.mcpApi.getInfo());
        this.serverInfo.set(info);
        return info;
      },
      listTools: async () => {
        const info =
          this.serverInfo() ?? (await firstValueFrom(this.mcpApi.getInfo()));
        this.serverInfo.set(info);
        return info.tools;
      },
      callTool: async (toolName, args = {}) => {
        const enrichedArgs = this.withActiveStudioArgs(args);
        const result = await firstValueFrom(
          this.mcpApi.callTool(toolName, enrichedArgs),
        );
        if (MUTATING_TOOLS.has(toolName)) {
          void this.store.reloadSnapshot();
        }
        return result;
      },
      promptLead: async (prompt, options = {}) => {
        return bridge.callTool('prompt_lead', {
          prompt,
          ...options,
        });
      },
      promptAgent: async (agentKey, prompt, options = {}) => {
        return bridge.callTool('prompt_agent', {
          agentKey,
          prompt,
          ...options,
        });
      },
      answerNow: async (agentKey = 'lead') => {
        return bridge.callTool('answer_now', { agentKey });
      },
      jsonRpc: async (payload) => {
        return firstValueFrom(this.mcpApi.sendJsonRpc(payload));
      },
    };

    window.robdevMcp = bridge;
    this.bridgeReady.set(true);

    try {
      const info = await bridge.getServerInfo();
      this.registerWebMcpTools(info.tools, bridge);
    } catch {
      // Backend may still be starting up; tools can still be fetched on demand.
    }
  }

  private withActiveStudioArgs(
    args: Record<string, unknown>,
  ): Record<string, unknown> {
    if (args['studioId'] || args['studioSlug']) {
      return args;
    }
    const currentStudio = this.store.studio();
    if (!currentStudio) return args;
    return {
      studioId: currentStudio.id,
      ...args,
    };
  }

  private registerWebMcpTools(
    tools: McpToolDefinitionDto[],
    bridge: RobdevPageMcpBridge,
  ): void {
    if (typeof navigator === 'undefined' || !navigator.modelContext) {
      return;
    }
    this.webMcpSupported.set(true);

    const descriptors = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      execute: async (args: Record<string, unknown>) =>
        bridge.callTool(tool.name, args),
    }));

    if (typeof navigator.modelContext.provideContext === 'function') {
      try {
        navigator.modelContext.provideContext({ tools: descriptors });
        return;
      } catch {
        // Fallback to registerTool
      }
    }

    if (typeof navigator.modelContext.registerTool === 'function') {
      for (const desc of descriptors) {
        try {
          navigator.modelContext.registerTool(desc);
        } catch {
          // Ignore duplicate tool registration errors
        }
      }
    }
  }
}
