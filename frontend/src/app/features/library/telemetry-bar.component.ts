import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import {
  AGENT_BY_KEY,
  countChars,
  countWords,
  type VaultDocumentDto,
} from '@robdev/shared';
import { RelativeTimePipe } from '../../shared/pipes/relative-time.pipe';
import { AgentAvatarComponent } from '../../shared/ui/agent-avatar/agent-avatar.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';

@Component({
  selector: 'rd-telemetry-bar',
  standalone: true,
  imports: [DecimalPipe, RelativeTimePipe, AgentAvatarComponent, IconComponent],
  templateUrl: './telemetry-bar.component.html',
  styleUrl: './telemetry-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TelemetryBarComponent {
  readonly markdown = input.required<string>();
  readonly doc = input.required<VaultDocumentDto | null>();

  readonly openDoc = output<string>();

  readonly backlinksOpen = signal(false);

  readonly words = computed(() => countWords(this.markdown()));
  readonly chars = computed(() => countChars(this.markdown()));

  readonly linkedAgentChips = computed(() => {
    const d = this.doc();
    if (!d) return [];
    return d.linkedAgents.map((la) => ({
      ...la,
      agent: {
        ...AGENT_BY_KEY[la.agentKey],
        status: 'IDLE' as const,
      },
      tooltip: `${AGENT_BY_KEY[la.agentKey].name} · ${la.source}${la.priority !== null ? ` (p${la.priority})` : ''}`,
    }));
  });

  selectBacklink(docId: string): void {
    this.backlinksOpen.set(false);
    this.openDoc.emit(docId);
  }
}
