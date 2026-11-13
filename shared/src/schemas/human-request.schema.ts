import { z } from 'zod';

export const ReplyHumanRequestSchema = z.object({
  body: z.string().trim().min(1).max(8000),
  optionId: z.string().max(40).optional(),
});
export type ReplyHumanRequest = z.infer<typeof ReplyHumanRequestSchema>;

export const ResolveHumanRequestSchema = z.object({
  outcome: z.enum(['RESOLVED', 'DISMISSED']).default('RESOLVED'),
  note: z.string().max(2000).optional(),
});
export type ResolveHumanRequest = z.infer<typeof ResolveHumanRequestSchema>;
