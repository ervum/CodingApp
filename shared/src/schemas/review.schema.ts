import { z } from 'zod';

export const ListReviewQuerySchema = z.object({
  tab: z.enum(['IMAGES_VIDEO', 'STAGES_PUBLISH']).default('IMAGES_VIDEO'),
  status: z.enum(['TO_REVIEW', 'CHANGES_ASKED', 'APPROVED', 'REJECTED', 'ALL']).default('TO_REVIEW'),
  gameId: z.string().optional(),
});
export type ListReviewQuery = z.infer<typeof ListReviewQuerySchema>;

export const ReviewAnnotationSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0.01).max(1),
  h: z.number().min(0.01).max(1),
  note: z.string().trim().min(1).max(500),
});
export type ReviewAnnotation = z.infer<typeof ReviewAnnotationSchema>;

export const VerdictRequestSchema = z.discriminatedUnion('verdict', [
  z.object({
    verdict: z.literal('APPROVE'),
    feedback: z.string().max(4000).optional(),
    annotations: z.array(ReviewAnnotationSchema).max(20).optional(),
  }),
  z.object({
    verdict: z.literal('ASK_CHANGES'),
    feedback: z.string().trim().min(3).max(4000),
    annotations: z.array(ReviewAnnotationSchema).max(20).optional(),
  }),
  z.object({
    verdict: z.literal('REJECT'),
    feedback: z.string().max(4000).optional(),
    annotations: z.array(ReviewAnnotationSchema).max(20).optional(),
  }),
]);
export type VerdictRequest = z.infer<typeof VerdictRequestSchema>;

export const UploadReviewMetaSchema = z.object({
  gameId: z.string().nullable().default(null),
  kind: z.enum(['ICON', 'THUMBNAIL', 'TRAILER']),
  title: z.string().trim().min(3).max(140),
  description: z.string().max(4000).optional(),
});
export type UploadReviewMeta = z.infer<typeof UploadReviewMetaSchema>;

export const UpdateBlockerSchema = z.object({
  status: z.enum(['OPEN', 'RESOLVED', 'WAIVED']),
});
export type UpdateBlockerRequest = z.infer<typeof UpdateBlockerSchema>;
