import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  computed,
  effect,
  inject,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AGENT_ROSTER, type AgentKey, type QuickJumpResultDto } from '@robdev/shared';
import { firstValueFrom } from 'rxjs';
import { SearchApiService } from '../../core/api/search-api.service';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { AgentAvatarComponent } from '../../shared/ui/agent-avatar/agent-avatar.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import type { IconName } from '../../shared/ui/icon/icons';
import { KbdComponent } from '../../shared/ui/kbd/kbd.component';

export interface PaletteEntry {
  id: string;
  group: 'ACTIONS' | 'GO TO' | 'CONVERSATIONS' | 'SEARCH RESULTS';
  label: string;
  sublabel: string;
  agentKey?: AgentKey;
  icon?: IconName;
  action: 'new-task' | 'navigate';
  route?: string;
}

export interface PaletteEntryGroup {
  title: string;
  items: PaletteEntry[];
}

const STATIC_GO_TO: Array<{ id: string; label: string; sublabel: string; segment: string; icon: IconName }> = [
  { id: 'goto-home', label: 'Home', sublabel: 'Workspace', segment: 'home', icon: 'home' },
  { id: 'goto-lead', label: 'Lead', sublabel: 'Workspace', segment: 'lead', icon: 'lead' },
  { id: 'goto-team', label: 'Team', sublabel: 'Workspace', segment: 'team', icon: 'team' },
  { id: 'goto-tasks', label: 'Tasks', sublabel: 'Workspace', segment: 'tasks', icon: 'tasks' },
  { id: 'goto-review', label: 'Review', sublabel: 'Workspace', segment: 'review', icon: 'review' },
  { id: 'goto-workspace', label: 'Workspace Explorer', sublabel: '/workspace/ files, versions, diffs & comments', segment: 'workspace', icon: 'folder' },
  { id: 'goto-games', label: 'Games', sublabel: 'Studio', segment: 'games', icon: 'games' },
  { id: 'goto-pitches', label: 'Pitches', sublabel: 'Studio', segment: 'pitches', icon: 'pitches' },
  { id: 'goto-market', label: 'Market', sublabel: 'Studio', segment: 'market', icon: 'market' },
  { id: 'goto-library', label: 'Library', sublabel: 'Studio', segment: 'library', icon: 'library' },
  { id: 'goto-usage', label: 'Usage & Budgets', sublabel: 'Tokens, Cost & Guardrails', segment: 'usage', icon: 'sparkles' },
  { id: 'goto-settings', label: 'Settings', sublabel: 'Studio', segment: 'settings', icon: 'settings' },
];

@Component({
  selector: 'rd-command-palette',
  standalone: true,
  imports: [FormsModule, IconComponent, KbdComponent, AgentAvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './command-palette.component.html',
  styleUrl: './command-palette.component.scss',
})
export class CommandPaletteComponent {
  private readonly searchApi = inject(SearchApiService);
  private readonly store = inject(StudioStoreService);
  private readonly router = inject(Router);

  readonly open = model<boolean>(false);
  readonly openNewTask = output<void>();

  readonly query = signal('');
  readonly remoteResults = signal<QuickJumpResultDto[]>([]);
  readonly activeIndex = signal(0);

  private readonly inputRef = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      if (this.open()) {
        this.query.set('');
        this.activeIndex.set(0);
        void this.fetchResults('');
        setTimeout(() => {
          this.inputRef()?.nativeElement.focus();
        }, 0);
      }
    });
  }

  readonly allItems = computed<PaletteEntry[]>(() => {
    const slug = this.store.studio()?.slug ?? 'inclined-games';
    const q = this.query().trim().toLowerCase();

    const matches = (entry: PaletteEntry): boolean =>
      !q ||
      entry.label.toLowerCase().includes(q) ||
      entry.sublabel.toLowerCase().includes(q);

    const rawActions: PaletteEntry[] = [
      {
        id: 'action-new-task',
        group: 'ACTIONS',
        label: '+ New task',
        sublabel: 'Pick an agent and tell it what to do',
        icon: 'plus',
        action: 'new-task',
      },
      ...AGENT_ROSTER.map(
        (agent): PaletteEntry => ({
          id: `action-talk-${agent.key}`,
          group: 'ACTIONS',
          label: `Talk to ${agent.name}`,
          sublabel: agent.title,
          agentKey: agent.key,
          action: 'navigate',
          route: agent.key === 'lead' ? `/s/${slug}/lead` : `/s/${slug}/team/${agent.key}`,
        }),
      ),
    ];

    const actions = rawActions.filter(matches);

    const goTo: PaletteEntry[] = STATIC_GO_TO.map(
      (g): PaletteEntry => ({
        id: g.id,
        group: 'GO TO',
        label: g.label,
        sublabel: g.sublabel,
        icon: g.icon,
        action: 'navigate',
        route: `/s/${slug}/${g.segment}`,
      }),
    ).filter(matches);

    const liveAgents = this.store.agents();
    const convSource =
      liveAgents.length > 0
        ? liveAgents.slice(0, 6).map((a) => ({
            id: `conv-${a.key}`,
            label: `${a.name} · ${a.currentTaskTitle ?? a.title}`,
            sublabel: a.lastSnippet ?? (a.status === 'WORKING' ? 'Working now' : 'Recent thread'),
            agentKey: a.key,
          }))
        : AGENT_ROSTER.slice(0, 5).map((a) => ({
            id: `conv-${a.key}`,
            label: `${a.name} · ${a.title}`,
            sublabel: 'Recent thread',
            agentKey: a.key,
          }));

    const conversations: PaletteEntry[] = convSource
      .map(
        (c): PaletteEntry => ({
          id: c.id,
          group: 'CONVERSATIONS',
          label: c.label,
          sublabel: c.sublabel,
          agentKey: c.agentKey,
          action: 'navigate',
          route: c.agentKey === 'lead' ? `/s/${slug}/lead` : `/s/${slug}/team/${c.agentKey}`,
        }),
      )
      .filter(matches);

    const iconForResult = (type: QuickJumpResultDto['type']): IconName => {
      switch (type) {
        case 'game':
          return 'games';
        case 'doc':
          return 'library';
        case 'pitch':
          return 'pitches';
        case 'task':
          return 'tasks';
        case 'review':
          return 'review';
        default:
          return 'search';
      }
    };

    const searchEntries: PaletteEntry[] = this.remoteResults()
      .filter((r) => r.type !== 'route' && r.type !== 'agent')
      .map(
        (r): PaletteEntry => ({
          id: `remote-${r.type}-${r.id}`,
          group: 'SEARCH RESULTS',
          label: r.label,
          sublabel: `${r.type.toUpperCase()} · ${r.sublabel}`,
          icon: iconForResult(r.type),
          action: 'navigate',
          route: r.route.startsWith('/s/') ? r.route : `/s/${slug}${r.route}`,
        }),
      );

    return [...searchEntries, ...actions, ...goTo, ...conversations];
  });

  readonly groups = computed<PaletteEntryGroup[]>(() => {
    const order: Array<'SEARCH RESULTS' | 'ACTIONS' | 'GO TO' | 'CONVERSATIONS'> = [
      'SEARCH RESULTS',
      'ACTIONS',
      'GO TO',
      'CONVERSATIONS',
    ];
    const all = this.allItems();
    return order
      .map((title) => ({
        title,
        items: all.filter((item) => item.group === title),
      }))
      .filter((g) => g.items.length > 0);
  });

  onQueryChange(val: string): void {
    this.query.set(val);
    this.activeIndex.set(0);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      void this.fetchResults(val);
    }, 150);
  }

  private async fetchResults(q: string): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId) return;
    try {
      const res = await firstValueFrom(this.searchApi.quickJump(studioId, q.trim()));
      this.remoteResults.set(res);
    } catch {
      this.remoteResults.set([]);
    }
  }

  onKeydown(event: KeyboardEvent): void {
    const items = this.allItems();
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (items.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.activeIndex.update((i) => (i + 1) % items.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.activeIndex.update((i) => (i - 1 + items.length) % items.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = items[this.activeIndex()];
      if (target) {
        void this.selectItem(target);
      }
    }
  }

  async selectItem(item: PaletteEntry): Promise<void> {
    this.close();
    if (item.action === 'new-task') {
      this.openNewTask.emit();
      return;
    }
    if (item.route) {
      await this.router.navigateByUrl(item.route);
    }
  }

  close(): void {
    this.open.set(false);
  }
}
