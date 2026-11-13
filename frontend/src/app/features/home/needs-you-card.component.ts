import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AGENT_BY_KEY,
  type AgentKey,
  type GameDto,
  type HumanRequestDto,
  type PitchDto,
} from '@robdev/shared';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { AgentAvatarComponent } from '../../shared/ui/agent-avatar/agent-avatar.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';

const AGENT_BORDER_COLOR: Partial<Record<AgentKey, string>> = {
  builder: '#22C55E',
  frame: '#EC4899',
  reviewer: '#14B8A6',
  tester108: '#38BDF8',
  splash: '#F97316',
};

@Component({
  selector: 'rd-needs-you-card',
  standalone: true,
  imports: [FormsModule, AgentAvatarComponent, IconComponent],
  templateUrl: './needs-you-card.component.html',
  styleUrl: './needs-you-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NeedsYouCardComponent {
  readonly store = inject(StudioStoreService);

  readonly request = input.required<HumanRequestDto>();
  readonly game = input<GameDto | null>(null);
  readonly pitches = input<PitchDto[]>([]);

  readonly reply = output<{ id: string; body: string; optionId?: string }>();
  readonly done = output<string>();
  readonly details = output<HumanRequestDto>();

  readonly replyOpen = signal(false);
  readonly replyText = signal('');

  readonly agentKey = computed<AgentKey>(() => this.request().agentKey ?? 'lead');

  readonly agentInfo = computed(() => {
    const key = this.agentKey();
    const roster = AGENT_BY_KEY[key];
    return {
      key,
      name: roster.name,
      glyph: roster.glyph,
      color: AGENT_BORDER_COLOR[key] ?? roster.color,
      status: 'WAITING_ON_HUMAN' as const,
    };
  });

  readonly headerText = computed(() =>
    this.request().title.toLowerCase().includes('permission required')
      ? `${this.agentInfo().name.toUpperCase()} · PERMISSION REQUIRED`
      : `${this.agentInfo().name.toUpperCase()} FINISHED · CHECK IT`,
  );

  chooseOption(optionId: string, label: string): void {
    this.reply.emit({
      id: this.request().id,
      body: label,
      optionId,
    });
  }

  toggleReply(): void {
    this.replyOpen.update((v) => !v);
  }

  onReplyKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      this.submitReply();
    }
  }

  submitReply(): void {
    const body = this.replyText().trim();
    if (!body) return;
    this.reply.emit({ id: this.request().id, body });
    this.replyText.set('');
    this.replyOpen.set(false);
  }
}
