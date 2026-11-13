import { z } from 'zod';

export const CreateStudioSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().regex(/^[a-z0-9-]{3,40}$/),
});
export type CreateStudioRequest = z.infer<typeof CreateStudioSchema>;

export const UpdateStudioSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  browserHeadless: z.boolean().optional(),
  autoDeleteCreatedChats: z.boolean().optional(),
  codingMode: z.enum(['ROBLOX_MCP', 'LOCAL_SYNC']).optional(),
  codingSyncTool: z.enum(['SILICON', 'ROJO', 'AZUL', 'ARGON', 'PESTO', 'RBXMK']).optional(),
  contextMode: z.enum(['ROBLOX', 'GENERAL']).optional(),
  allowTerminalWithoutPermission: z.boolean().optional(),
  allowExternalFilesWithoutPermission: z.boolean().optional(),
  allowPcControlWithoutPermission: z.boolean().optional(),
  pcIdleTakeoverSeconds: z.number().int().min(10).max(3600).optional(),
  sandboxAccessPolicy: z.enum(['ALLOW', 'ASK', 'DENY']).optional(),
  sandboxProviderKind: z.enum(['LOCAL', 'CLOUD_GPU']).optional(),
  maxConcurrentSandboxes: z.number().int().min(1).max(15).optional(),
  allowAutoSaveVersion: z.boolean().optional(),
  allowAutoPublish: z.boolean().optional(),
  robloxUniverseId: z.string().trim().max(80).nullable().optional(),
  robloxPlaceId: z.string().trim().max(80).nullable().optional(),
  openCloudApiKey: z.string().trim().max(2000).nullable().optional(),
  dailyTokenBudget: z.number().int().min(1000).nullable().optional(),
  dailyCostBudgetUsd: z.number().min(0.01).nullable().optional(),
  perTaskTokenBudget: z.number().int().min(500).nullable().optional(),
});
export type UpdateStudioRequest = z.infer<typeof UpdateStudioSchema>;

export const CreateLaneSchema = z.object({
  name: z.string().trim().min(2).max(60),
});
export type CreateLaneRequest = z.infer<typeof CreateLaneSchema>;

export const AddMemberSchema = z.object({
  email: z.email(),
  role: z.enum(['ADMIN', 'PRODUCER', 'VIEWER']),
});
export type AddMemberRequest = z.infer<typeof AddMemberSchema>;

export const UpdateMemberSchema = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'PRODUCER', 'VIEWER']),
});
export type UpdateMemberRequest = z.infer<typeof UpdateMemberSchema>;
