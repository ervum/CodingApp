import { z } from 'zod';

export const AddWorkspaceFileCommentSchema = z.object({
  path: z.string().trim().min(1).max(400),
  body: z.string().trim().min(1).max(4000),
  version: z.number().int().positive().optional(),
  lineStart: z.number().int().min(1).max(100_000).nullable().optional(),
  lineEnd: z.number().int().min(1).max(100_000).nullable().optional(),
});
export type AddWorkspaceFileCommentRequest = z.infer<
  typeof AddWorkspaceFileCommentSchema
>;

export const SaveWorkspaceFileSchema = z.object({
  path: z.string().trim().min(1).max(400),
  content: z.string().max(400_000),
  language: z.string().trim().max(40).optional(),
  comment: z.string().trim().max(2000).optional(),
});
export type SaveWorkspaceFileRequest = z.infer<typeof SaveWorkspaceFileSchema>;
