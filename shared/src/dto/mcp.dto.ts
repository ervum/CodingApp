export type McpToolCategory =
  | 'Lead & Agent Chat'
  | 'Agents & Runs'
  | 'Models, Browser & Web Chats'
  | 'Tasks & Queue'
  | 'Studio & Lanes'
  | 'Human Requests'
  | 'Games & Pitches'
  | 'Market Intelligence'
  | 'Vault & Reviews';

export interface McpToolDefinitionDto {
  name: string;
  category: McpToolCategory;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  exampleArgs: Record<string, unknown>;
}

export interface McpServerInfoDto {
  serverName: string;
  version: string;
  protocolVersion: string;
  httpEndpoint: string;
  sseEndpoint: string;
  stdioCommand: string;
  stdioArgs: string[];
  defaultStudioId: string | null;
  defaultStudioSlug: string | null;
  defaultStudioName: string | null;
  toolCount: number;
  tools: McpToolDefinitionDto[];
}

export interface McpToolCallResultDto {
  toolName: string;
  isError: boolean;
  durationMs: number;
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: unknown;
}
