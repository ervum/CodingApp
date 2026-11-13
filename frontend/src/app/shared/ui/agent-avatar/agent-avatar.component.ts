import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { AGENT_BY_KEY, type AgentDto, type AgentKey } from '@robdev/shared';
import { IconComponent } from '../icon/icon.component';
import type { IconName } from '../icon/icons';

export type AgentAvatarSize = 'xs' | 'sm' | 'md' | 'lg';

const GLYPH_TO_ICON: Record<string, IconName> = {
  LD: 'agent-lead',
  PU: 'agent-pulse',
  AR: 'agent-architect',
  BU: 'agent-builder',
  FR: 'agent-frame',
  SC: 'agent-scenic',
  BA: 'agent-balance',
  LI: 'agent-librarian',
  SP: 'agent-splash',
  PR: 'agent-producer',
  LO: 'agent-liveops',
  ME: 'agent-merchant',
  PT: 'agent-playtest',
  '108': 'agent-tester108',
  RV: 'agent-reviewer',
  BW: 'agent-browser',
};

export function agentIconFor(agent: { key?: AgentKey; glyph?: string; name?: string }): IconName {
  if (agent.key) {
    return `agent-${agent.key}` as IconName;
  }
  if (agent.glyph && GLYPH_TO_ICON[agent.glyph]) {
    return GLYPH_TO_ICON[agent.glyph]!;
  }
  const n = (agent.name ?? '').toLowerCase();
  if (n.includes('108')) return 'agent-tester108';
  const candidate = `agent-${n}` as IconName;
  return GLYPH_TO_ICON[agent.glyph ?? ''] ?? candidate ?? 'bot';
}

@Component({
  selector: 'rd-agent-avatar',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './agent-avatar.component.html',
  styleUrl: './agent-avatar.component.scss',
  host: {
    '[attr.data-size]': 'size()',
    '[attr.data-status]': 'resolvedAgent().status',
    '[style.--rd-agent-color]': 'resolvedAgent().color',
  },
})
export class AgentAvatarComponent {
  readonly agent = input<
    (Pick<AgentDto, 'name' | 'glyph' | 'color' | 'status'> & { key?: AgentKey }) | undefined
  >(undefined);
  readonly agentKey = input<AgentKey | undefined>(undefined);
  readonly size = input<AgentAvatarSize>('md');
  readonly showStatus = input<boolean>(false);

  readonly resolvedAgent = computed(() => {
    const a = this.agent();
    if (a) return a;
    const key = this.agentKey() ?? 'lead';
    const r = AGENT_BY_KEY[key];
    return {
      key: r.key,
      name: r.name,
      glyph: r.glyph,
      color: r.color,
      status: 'IDLE' as const,
    };
  });

  readonly iconName = computed<IconName>(() => agentIconFor(this.resolvedAgent()));
  readonly iconSize = computed<number>(() => {
    switch (this.size()) {
      case 'xs':
        return 12;
      case 'sm':
        return 14;
      case 'lg':
        return 20;
      default:
        return 16;
    }
  });
}
