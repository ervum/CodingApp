import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { SearchService } from './search.service.js';

describe('SearchService', () => {
  it('returns matching routes and entities with valid router links', async () => {
    const mockPrisma = {
      agent: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'a1', key: 'builder', name: 'Builder', title: 'Core Luau Engineer', status: 'IDLE' },
        ]),
      },
      game: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'g1', slug: 'neon-obby', name: 'Neon Obby', genre: 'Obby', status: 'BUILDING' },
        ]),
      },
      vaultDocument: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'd1', title: 'Architecture', path: 'systems/arch.md' },
        ]),
      },
      pitch: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'p1', title: 'Tower Defense X', genre: 'Strategy', status: 'DRAFT' },
        ]),
      },
      task: {
        findMany: vi.fn().mockResolvedValue([
          { id: 't1', title: 'Implement Combat', status: 'RUNNING', agent: { name: 'Builder' } },
        ]),
      },
      reviewItem: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'rv1', title: 'Main Menu HUD', kind: 'VISUAL', status: 'PENDING' },
        ]),
      },
    } as unknown as PrismaService;

    const service = new SearchService(mockPrisma);
    const results = await service.quickJump('studio-1', 'settings');
    expect(results.some((r) => r.route === '/settings')).toBe(true);
    expect(results.some((r) => r.route === '/games/neon-obby')).toBe(true);
    expect(results.some((r) => r.route === '/pitches/p1')).toBe(true);
    expect(results.some((r) => r.route === '/tasks?task=t1')).toBe(true);
    expect(results.some((r) => r.route === '/review?item=rv1')).toBe(true);
  });
});
