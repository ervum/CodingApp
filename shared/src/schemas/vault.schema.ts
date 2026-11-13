import { z } from 'zod';

export const CreateVaultDocumentSchema = z.object({
  folderId: z.string(),
  title: z.string().trim().min(1).max(120).regex(/^[^/\\:*?"<>|]+$/),
  markdown: z.string().max(200_000).default(''),
});
export type CreateVaultDocumentRequest = z.infer<typeof CreateVaultDocumentSchema>;

export const SaveVaultDocumentSchema = z.object({
  markdown: z.string().max(200_000),
  baseVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(120).regex(/^[^/\\:*?"<>|]+$/).optional(),
  tags: z.array(z.string().max(32)).max(20).optional(),
  alwaysInject: z.boolean().optional(),
});
export type SaveVaultDocumentRequest = z.infer<typeof SaveVaultDocumentSchema>;

export const CreateVaultFolderSchema = z.object({
  parentId: z.string().nullable().default(null),
  name: z.string().trim().min(1).max(80).regex(/^[^/\\:*?"<>|]+$/),
});
export type CreateVaultFolderRequest = z.infer<typeof CreateVaultFolderSchema>;

export const VaultSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(30).default(10),
});
export type VaultSearchQuery = z.infer<typeof VaultSearchQuerySchema>;
