import { z } from 'zod';
import { AgentToolTuple, ChatDirectiveTuple } from '../enums.js';

export const UpdateAgentSchema = z.object({
  systemPrompt: z.string().min(50).max(20_000).optional(),
  isEnabled: z.boolean().optional(),
  llmConnectionId: z.string().nullable().optional(),
  modelId: z.string().min(1).max(200).nullable().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().min(256).max(64_000).optional(),
  imageConnectionId: z.string().nullable().optional(),
  imageModelId: z.string().min(1).max(200).nullable().optional(),
  tools: z.array(z.enum(AgentToolTuple)).max(60).optional(),
});
export type UpdateAgentRequest = z.infer<typeof UpdateAgentSchema>;

export const PutVaultBindingsSchema = z.object({
  bindings: z.array(z.object({ documentId: z.string(), priority: z.number().int().min(1).max(99) })).max(30),
});
export type PutVaultBindingsRequest = z.infer<typeof PutVaultBindingsSchema>;

export const ChatAttachmentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('vault_doc'),
    documentId: z.string().min(1),
    path: z.string().min(1).max(400),
    title: z.string().min(1).max(200),
  }),
  z.object({
    kind: z.literal('workspace_file'),
    path: z.string().min(1).max(400),
    relPath: z.string().max(400).optional(),
    bytes: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal('workspace_folder'),
    path: z.string().min(1).max(400),
    relPath: z.string().max(400).optional(),
    fileCount: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal('game'),
    gameId: z.string().min(1),
    name: z.string().min(1).max(200),
  }),
  z.object({
    kind: z.literal('task'),
    taskId: z.string().min(1),
    title: z.string().min(1).max(200),
  }),
  z.object({
    kind: z.literal('chat_artifact'),
    path: z.string().min(1).max(400),
    runId: z.string().nullable().optional(),
    artifactId: z.string().optional(),
    language: z.string().max(60).optional(),
  }),
  z.object({
    kind: z.literal('upload_file'),
    uploadId: z.string().min(1),
    name: z.string().min(1).max(260),
    mimeType: z.string().max(120),
    bytes: z.number().int().nonnegative(),
    relativePath: z.string().max(400).optional(),
    relPath: z.string().max(400).optional(),
  }),
  z.object({
    kind: z.literal('upload_folder'),
    uploadId: z.string().min(1),
    rootName: z.string().min(1).max(260),
    name: z.string().max(260).optional(),
    fileCount: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal('local_folder'),
    absPath: z.string().min(1).max(600),
    name: z.string().max(260).optional(),
  }),
  z.object({
    kind: z.literal('image'),
    mediaId: z.string().min(1),
    name: z.string().min(1).max(260),
    mimeType: z.string().max(120).optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    previewUrl: z.string().max(1000).optional(),
    source: z.enum(['screenshot', 'upload', 'paste']).optional(),
  }),
]);

export const PostAgentMessageSchema = z.object({
  body: z.string().trim().min(1).max(8000),
  gameId: z.string().nullable().default(null),
  taskId: z.string().nullable().optional(),
  attachments: z.array(ChatAttachmentSchema).max(20).default([]),
  directives: z.array(z.enum(ChatDirectiveTuple)).max(4).default([]),
});
export type PostAgentMessageRequest = z.infer<typeof PostAgentMessageSchema>;

export const ChatTurnRefSchema = z.object({
  taskId: z.string().nullable(),
  promptMessageId: z.string().nullable(),
  runIds: z.array(z.string()).max(100).default([]),
});

export const ChatBranchSchema = z.object({
  ref: ChatTurnRefSchema,
  part: z.enum(['USER', 'AI']),
});
export const ChatBranchRequestSchema = ChatBranchSchema;
export type ChatBranchRequest = z.infer<typeof ChatBranchSchema>;

export const ChatRetrySchema = z.object({
  ref: ChatTurnRefSchema,
  mode: z.enum(['CURRENT', 'CURRENT_AGENT', 'SAME_AGENT']),
  sourceRunId: z.string().nullable().optional(),
  promptText: z.string().trim().max(8000).optional(),
});
export const ChatRetryRequestSchema = ChatRetrySchema;
export type ChatRetryRequest = z.infer<typeof ChatRetrySchema>;

export const ChatDeletePartSchema = z.object({
  ref: ChatTurnRefSchema,
  part: z.enum(['USER', 'AI']),
});
export const ChatDeletePartRequestSchema = ChatDeletePartSchema;
export type ChatDeletePartRequest = z.infer<typeof ChatDeletePartSchema>;
