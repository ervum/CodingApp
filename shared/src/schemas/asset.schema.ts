import { z } from 'zod';
import { StudioAssetKindTuple } from '../enums.js';

export const ListStudioAssetsQuerySchema = z.object({
  kind: z.enum(StudioAssetKindTuple).optional(),
  q: z.string().trim().max(200).optional(),
  tag: z.string().trim().max(60).optional(),
});
export type ListStudioAssetsQuery = z.infer<typeof ListStudioAssetsQuerySchema>;

export const CreateStudioAssetSchema = z.object({
  kind: z.enum(StudioAssetKindTuple),
  name: z.string().trim().min(2).max(120),
  tags: z.array(z.string().trim().min(1).max(32)).max(12).default([]),
  robloxAssetId: z.string().trim().regex(/^\d{1,20}$/).nullable().default(null),
  mediaId: z.string().trim().min(1).nullable().default(null),
  notes: z.string().max(2000).default(''),
});
export type CreateStudioAssetRequest = z.infer<typeof CreateStudioAssetSchema>;

export const UpdateStudioAssetSchema = z.object({
  kind: z.enum(StudioAssetKindTuple).optional(),
  name: z.string().trim().min(2).max(120).optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(12).optional(),
  robloxAssetId: z.string().trim().regex(/^\d{1,20}$/).nullable().optional(),
  notes: z.string().max(2000).optional(),
});
export type UpdateStudioAssetRequest = z.infer<typeof UpdateStudioAssetSchema>;
