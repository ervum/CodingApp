import { Injectable } from '@nestjs/common';
import type { QuickJumpResultDto } from '@robdev/shared';
import { PrismaService } from '../../prisma/prisma.service.js';

const STATIC_ROUTES: ReadonlyArray<QuickJumpResultDto> = [
  { type: 'route', id: 'route:home', label: 'Home', sublabel: 'Command Center', route: '/home' },
  { type: 'route', id: 'route:lead', label: 'Lead', sublabel: 'Orchestrator Console', route: '/lead' },
  { type: 'route', id: 'route:team', label: 'Team', sublabel: '15 Specialist Agents', route: '/team' },
  { type: 'route', id: 'route:tasks', label: 'Tasks', sublabel: 'Task Queue & DAG', route: '/tasks' },
  { type: 'route', id: 'route:review', label: 'Review', sublabel: 'Approval Queue', route: '/review' },
  { type: 'route', id: 'route:output', label: 'Output', sublabel: 'Delivered Artifacts', route: '/output' },
  { type: 'route', id: 'route:workspace', label: 'Workspace', sublabel: 'Code & Silicon Editor', route: '/workspace' },
  { type: 'route', id: 'route:games', label: 'Games', sublabel: 'Studio Games & Builds', route: '/games' },
  { type: 'route', id: 'route:pitches', label: 'Pitches', sublabel: 'Market-Backed Concepts', route: '/pitches' },
  { type: 'route', id: 'route:market', label: 'Market', sublabel: 'Roblox Charts & CCU', route: '/market' },
  { type: 'route', id: 'route:library', label: 'Library', sublabel: 'Knowledge Vault & Assets', route: '/library' },
  { type: 'route', id: 'route:usage', label: 'Usage & Budgets', sublabel: 'Token & Cost Analytics', route: '/usage' },
  { type: 'route', id: 'route:settings', label: 'Models & Connections', sublabel: 'Studio Settings', route: '/settings' },
];

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async quickJump(studioId: string, rawQuery: string): Promise<QuickJumpResultDto[]> {
    const q = rawQuery.trim();
    const qLower = q.toLowerCase();
    const results: QuickJumpResultDto[] = [];

    for (const r of STATIC_ROUTES) {
      if (
        !qLower ||
        r.label.toLowerCase().includes(qLower) ||
        r.sublabel.toLowerCase().includes(qLower)
      ) {
        results.push(r);
      }
    }

    const [agents, games, docs, pitches, tasks, reviewItems] = await Promise.all([
      this.prisma.agent.findMany({
        where: {
          studioId,
          ...(q
            ? {
                OR: [
                  { name: { contains: q, mode: 'insensitive' } },
                  { title: { contains: q, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: { sortOrder: 'asc' },
        take: 10,
      }),
      this.prisma.game.findMany({
        where: {
          studioId,
          ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
        },
        orderBy: { createdAt: 'asc' },
        take: 10,
      }),
      this.prisma.vaultDocument.findMany({
        where: {
          studioId,
          ...(q
            ? {
                OR: [
                  { title: { contains: q, mode: 'insensitive' } },
                  { path: { contains: q, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: { title: 'asc' },
        take: 10,
      }),
      this.prisma.pitch.findMany({
        where: {
          studioId,
          ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.task.findMany({
        where: {
          studioId,
          ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}),
        },
        include: { agent: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: q ? 10 : 5,
      }),
      this.prisma.reviewItem.findMany({
        where: {
          studioId,
          ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: q ? 10 : 5,
      }),
    ]);

    for (const a of agents) {
      results.push({
        type: 'agent',
        id: a.id,
        label: a.name,
        sublabel: `${a.status} · ${a.title}`,
        route: a.key === 'lead' ? '/lead' : `/team/${a.key}`,
      });
    }

    for (const g of games) {
      results.push({
        type: 'game',
        id: g.id,
        label: g.name,
        sublabel: `${g.genre} · ${g.status}`,
        route: `/games/${g.slug}`,
      });
    }

    for (const d of docs) {
      results.push({
        type: 'doc',
        id: d.id,
        label: d.title,
        sublabel: d.path,
        route: `/library?doc=${encodeURIComponent(d.id)}`,
      });
    }

    for (const p of pitches) {
      results.push({
        type: 'pitch',
        id: p.id,
        label: p.title,
        sublabel: `${p.genre} · ${p.status}`,
        route: `/pitches/${encodeURIComponent(p.id)}`,
      });
    }

    for (const t of tasks) {
      results.push({
        type: 'task',
        id: t.id,
        label: t.title,
        sublabel: `${t.agent.name} · ${t.status}`,
        route: `/tasks?task=${encodeURIComponent(t.id)}`,
      });
    }

    for (const rv of reviewItems) {
      results.push({
        type: 'review',
        id: rv.id,
        label: rv.title,
        sublabel: `${rv.kind} · ${rv.status}`,
        route: `/review?item=${encodeURIComponent(rv.id)}`,
      });
    }

    return results.slice(0, 20);
  }
}
