import {
  ChangeDetectionStrategy,
  Component,
  HostBinding,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { AGENT_ROSTER, AgentKey, type AgentDto, type AgentKey as AgentKeyType } from '@robdev/shared';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { AgentAvatarComponent } from '../../shared/ui/agent-avatar/agent-avatar.component';
import { AgentConsoleComponent } from './agent-console.component';
import { AgentConsoleStore } from './agent-console.store';
import { AgentListComponent } from './agent-list.component';

@Component({
  selector: 'rd-team-page',
  standalone: true,
  imports: [AgentListComponent, AgentConsoleComponent, AgentAvatarComponent],
  providers: [AgentConsoleStore],
  templateUrl: './team.page.html',
  styleUrl: './team.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TeamPage {
  readonly store = inject(StudioStoreService);
  private readonly router = inject(Router);

  readonly agentKey = input<string | undefined>();
  readonly fixedAgent = input<string | undefined>();
  readonly viewMode = signal<'console' | 'wall'>('console');

  @HostBinding('class.is-lead-only')
  get isLeadRoute(): boolean {
    return this.fixedAgent() === 'lead';
  }

  readonly activeAgentKey = computed<AgentKeyType>(() => {
    if (this.fixedAgent() === 'lead') return 'lead';
    const raw = this.agentKey();
    if (raw && raw in AgentKey) {
      return raw as AgentKeyType;
    }
    return 'frame';
  });

  readonly wallAgents = computed<AgentDto[]>(() => {
    const live = this.store.agents();
    if (live.length > 0) return live;
    return AGENT_ROSTER.map((r) => ({
      id: r.key,
      key: r.key,
      name: r.name,
      title: r.title,
      color: r.color,
      glyph: r.glyph,
      order: r.order,
      status: 'IDLE' as const,
      isEnabled: true,
      currentTaskId: null,
      currentTaskTitle: null,
      currentRunId: null,
      currentGameId: null,
      lastActivityAt: null,
      lastSnippet: r.title,
      modelLabel: null,
      lastErrorCode: null,
    }));
  });

  screenFor(key: AgentKeyType) {
    return this.store.agentScreens().find((s) => s.agentKey === key) ?? null;
  }

  onSelectAgent(key: AgentKeyType): void {
    this.viewMode.set('console');
    const slug = this.store.studio()?.slug ?? 'inclined-games';
    void this.router.navigate(['/s', slug, 'team', key]);
  }
}
