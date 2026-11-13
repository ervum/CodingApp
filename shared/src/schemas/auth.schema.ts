import { z } from 'zod';

export const RegisterRequestSchema = z.object({
  email: z.email().max(200).transform((e) => e.toLowerCase()),
  password: z.string().min(10).max(200),
  displayName: z.string().trim().min(2).max(60),
  studioName: z.string().trim().min(2).max(80).optional(),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
