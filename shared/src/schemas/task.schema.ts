import { z } from 'zod';
import { AgentKeyTuple, TaskStatusTuple } from '../enums.js';

export const CreateTaskSchema = z.object({
  agentKey: z.enum(AgentKeyTuple),
  title: z.string().trim().min(4).max(140),
  brief: z.string().trim().min(10).max(8000),
  gameId: z.string().nullable().default(null),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  tags: z.array(z.string().max(32)).max(8).default([]),
});
export type CreateTaskRequest = z.infer<typeof CreateTaskSchema>;

export const UpdateTaskSchema = z.object({
  title: z.string().trim().min(4).max(140).optional(),
  brief: z.string().trim().min(10).max(8000).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
});
export type UpdateTaskRequest = z.infer<typeof UpdateTaskSchema>;

export const ListTasksQuerySchema = z.object({
  status: z.enum(TaskStatusTuple).optional(),
  agentKey: z.enum(AgentKeyTuple).optional(),
  gameId: z.string().optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  inbox: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListTasksQuery = z.infer<typeof ListTasksQuerySchema>;

export const TaskFeedbackSchema = z.object({
  feedback: z.string().trim().min(3).max(4000),
});
export type TaskFeedbackRequest = z.infer<typeof TaskFeedbackSchema>;

export const LeadAskSchema = z.object({
  prompt: z.string().trim().min(3).max(8000),
  gameId: z.string().nullable().default(null),
});
export type LeadAskRequest = z.infer<typeof LeadAskSchema>;
