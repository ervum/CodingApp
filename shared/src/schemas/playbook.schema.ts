import { z } from 'zod';
import { AgentKeyTuple, GameStatusTuple } from '../enums.js';

export const PlaybookStepSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]{2,40}$/),
  agentKey: z.enum(AgentKeyTuple),
  title: z.string().trim().min(4).max(140),
  brief: z.string().trim().min(20).max(8000),
  dependsOn: z.array(z.string().regex(/^[a-z0-9-]{2,40}$/)).max(10).default([]),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
});
export type PlaybookStepInput = z.infer<typeof PlaybookStepSchema>;

export function validatePlaybookStepsAcyclic(
  steps: readonly PlaybookStepInput[],
): { ok: true } | { ok: false; message: string } {
  const keys = new Set<string>();
  for (const s of steps) {
    if (keys.has(s.key)) {
      return { ok: false, message: `Duplicate step key "${s.key}"` };
    }
    keys.add(s.key);
  }
  for (const s of steps) {
    for (const dep of s.dependsOn) {
      if (dep === s.key) {
        return { ok: false, message: `Step "${s.key}" cannot depend on itself` };
      }
      if (!keys.has(dep)) {
        return { ok: false, message: `Step "${s.key}" depends on unknown step "${dep}"` };
      }
    }
  }
  // Cycle detection via DFS coloring (0 = unvisited, 1 = visiting, 2 = visited)
  const state = new Map<string, 0 | 1 | 2>();
  const byKey = new Map(steps.map((s) => [s.key, s]));
  const hasCycle = (k: string): boolean => {
    const st = state.get(k) ?? 0;
    if (st === 1) return true;
    if (st === 2) return false;
    state.set(k, 1);
    const step = byKey.get(k);
    for (const dep of step?.dependsOn ?? []) {
      if (hasCycle(dep)) return true;
    }
    state.set(k, 2);
    return false;
  };
  for (const s of steps) {
    if (hasCycle(s.key)) {
      return { ok: false, message: `Cycle detected involving step "${s.key}"` };
    }
  }
  return { ok: true };
}

export const CreatePlaybookSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9-]{2,48}$/),
    name: z.string().trim().min(3).max(80),
    description: z.string().max(1000).default(''),
    steps: z.array(PlaybookStepSchema).min(1).max(25),
    suggestOnGameStatus: z.enum(GameStatusTuple).nullable().default(null),
  })
  .superRefine((val, ctx) => {
    const check = validatePlaybookStepsAcyclic(val.steps);
    if (!check.ok) {
      ctx.addIssue({ code: 'custom', path: ['steps'], message: check.message });
    }
  });
export type CreatePlaybookRequest = z.infer<typeof CreatePlaybookSchema>;

export const UpdatePlaybookSchema = z
  .object({
    name: z.string().trim().min(3).max(80).optional(),
    description: z.string().max(1000).optional(),
    steps: z.array(PlaybookStepSchema).min(1).max(25).optional(),
    suggestOnGameStatus: z.enum(GameStatusTuple).nullable().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.steps) {
      const check = validatePlaybookStepsAcyclic(val.steps);
      if (!check.ok) {
        ctx.addIssue({ code: 'custom', path: ['steps'], message: check.message });
      }
    }
  });
export type UpdatePlaybookRequest = z.infer<typeof UpdatePlaybookSchema>;

export const RunPlaybookSchema = z.object({
  gameId: z.string().nullable().default(null),
});
export type RunPlaybookRequest = z.infer<typeof RunPlaybookSchema>;
