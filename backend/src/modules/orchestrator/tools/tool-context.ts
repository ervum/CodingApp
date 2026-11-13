import type { AgentKey, AgentTool, ToolArgsOf } from '@robdev/shared';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { LogBuffer } from '../log-buffer.js';

export interface ToolContext {
  studioId: string;
  run: {
    id: string;
  };
  task: {
    id: string;
    title: string;
    gameId: string | null;
    metadata: Record<string, unknown> | null;
  };
  agent: {
    id: string;
    key: AgentKey;
    displayName: string;
    tools: AgentTool[];
    imageConnectionId: string | null;
    imageModelId: string | null;
  };
  game: {
    id: string;
    name: string;
  } | null;
  log: LogBuffer;
  prisma: PrismaService;
  userFacingAgentName: string;
  signal: AbortSignal;
}

export type ToolPayload =
  | ({ ok: true } & Record<string, unknown>)
  | ({
      ok: false;
      error?: string;
      message?: string;
      issues?: unknown;
    } & Record<string, unknown>)
  | ({ ok: boolean } & Record<string, unknown>);

export interface ToolResultImage {
  mediaId?: string;
  mimeType: string;
  base64: string;
  filePath?: string;
  width?: number;
  height?: number;
}

export interface ToolResult {
  payload: ToolPayload;
  control?: 'await-human';
  images?: ToolResultImage[];
}

export interface ToolHandler<T extends AgentTool = AgentTool> {
  readonly name: T;
  execute(args: ToolArgsOf<T>, ctx: ToolContext): Promise<ToolResult>;
}
