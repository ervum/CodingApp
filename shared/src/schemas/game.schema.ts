import { z } from 'zod';

export const CreateGameSchema = z.object({
  name: z.string().trim().min(2).max(80),
  genre: z.string().trim().min(2).max(60),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#A855F7'),
  description: z.string().max(2000).default(''),
});
export type CreateGameRequest = z.infer<typeof CreateGameSchema>;

export const UpdateGameSchema = CreateGameSchema.partial().extend({
  status: z.enum(['CONCEPT', 'BLUEPRINT', 'BUILDING', 'TESTING', 'LIVE', 'PAUSED']).optional(),
  robloxUniverseId: z.string().regex(/^\d{1,20}$/).nullable().optional(),
  robloxPlaceId: z.string().regex(/^\d{1,20}$/).nullable().optional(),
});
export type UpdateGameRequest = z.infer<typeof UpdateGameSchema>;

export const RecordBuildSchema = z.object({
  version: z.number().int().positive(),
  kind: z.enum(['SAVED', 'PUBLISHED']),
  notes: z.string().max(2000).default(''),
});
export type RecordBuildRequest = z.infer<typeof RecordBuildSchema>;

export const UpdateMilestoneSchema = z.object({
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE']),
});
export type UpdateMilestoneRequest = z.infer<typeof UpdateMilestoneSchema>;

export const PublishGameOpenCloudSchema = z.object({
  placeFile: z.string().trim().max(400).optional(),
  versionType: z.enum(['Saved', 'Published']).default('Published'),
  reviewItemId: z.string().trim().min(1),
  notes: z.string().max(1000).default(''),
});
export type PublishGameOpenCloudRequest = z.infer<typeof PublishGameOpenCloudSchema>;
