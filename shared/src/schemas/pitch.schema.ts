import { z } from 'zod';
import { PitchSectionKeyTuple } from '../enums.js';

export const GeneratePitchesSchema = z.object({
  focusGenre: z.string().max(60).nullable().default(null),
  notes: z.string().max(2000).default(''),
});
export type GeneratePitchesRequest = z.infer<typeof GeneratePitchesSchema>;

export const UpdatePitchSchema = z.object({
  title: z.string().trim().min(3).max(80).optional(),
  logline: z.string().trim().min(20).max(400).optional(),
  whatChanged: z.string().min(20).max(1200).optional(),
  howDifferent: z.string().min(20).max(1200).optional(),
  sections: z.array(z.object({ key: z.enum(PitchSectionKeyTuple), markdown: z.string().min(1).max(20_000) })).max(6).optional(),
});
export type UpdatePitchRequest = z.infer<typeof UpdatePitchSchema>;

export const PickPitchSchema = z.object({
  gameName: z.string().trim().min(2).max(80).optional(),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});
export type PickPitchRequest = z.infer<typeof PickPitchSchema>;

export const RequestPitchChangesSchema = z.object({
  feedback: z.string().trim().min(5).max(4000),
});
export type RequestPitchChanges = z.infer<typeof RequestPitchChangesSchema>;
export type RequestPitchChangesRequest = RequestPitchChanges;
