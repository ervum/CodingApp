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
import { RouterLink } from '@angular/router';
import {
  AGENT_BY_KEY,
  PITCH_SECTION_TITLES,
  PitchSectionKeyTuple,
  type PitchDetailDto,
  type PitchSectionDto,
  type UpdatePitchRequest,
} from '@robdev/shared';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { RelativeTimePipe } from '../../shared/pipes/relative-time.pipe';
import { AccordionComponent } from '../../shared/ui/accordion/accordion.component';
import { AgentAvatarComponent } from '../../shared/ui/agent-avatar/agent-avatar.component';
import { DialogComponent } from '../../shared/ui/dialog/dialog.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { MarkdownViewComponent } from '../../shared/ui/markdown-view/markdown-view.component';
import { StatusPillComponent } from '../../shared/ui/status-pill/status-pill.component';
import { MetricCalloutComponent } from './metric-callout.component';
import { PitchBannerComponent } from './pitch-banner.component';
import { PitchEditDialogComponent } from './pitch-edit-dialog.component';

@Component({
  selector: 'rd-pitch-detail',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    RelativeTimePipe,
    AccordionComponent,
    AgentAvatarComponent,
    DialogComponent,
    IconComponent,
    MarkdownViewComponent,
    StatusPillComponent,
    MetricCalloutComponent,
    PitchBannerComponent,
    PitchEditDialogComponent,
  ],
  templateUrl: './pitch-detail.component.html',
  styleUrl: './pitch-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PitchDetailComponent {
  readonly store = inject(StudioStoreService);

  readonly pitch = input.required<PitchDetailDto>();
  readonly canAct = input(false);
  readonly busy = input(false);

  readonly pick = output<void>();
  readonly editApprove = output<UpdatePitchRequest>();
  readonly requestChanges = output<string>();

  readonly editDialogOpen = signal(false);
  readonly changesDialogOpen = signal(false);
  readonly feedbackText = signal('');

  readonly studioSlug = computed(() => this.store.studio()?.slug ?? 'inclined-games');

  readonly authorAgent = computed(() => {
    const key = this.pitch().createdByAgentKey ?? 'pulse';
    return {
      ...AGENT_BY_KEY[key],
      status: 'IDLE' as const,
    };
  });

  readonly orderedSections = computed<PitchSectionDto[]>(() => {
    const byKey = new Map(this.pitch().sections.map((s) => [s.key, s]));
    return PitchSectionKeyTuple.map((key, idx) => {
      const existing = byKey.get(key);
      if (existing) return existing;
      return {
        key,
        title: PITCH_SECTION_TITLES[key],
        markdown: '_No notes recorded for this section._',
        sortOrder: idx,
      };
    });
  });

  readonly pickedGame = computed(() => {
    const gameId = this.pitch().pickedGameId;
    if (!gameId) return null;
    return this.store.games().find((g) => g.id === gameId) ?? null;
  });

  submitChangesRequest(): void {
    const text = this.feedbackText().trim();
    if (text.length < 5) return;
    this.requestChanges.emit(text);
    this.changesDialogOpen.set(false);
    this.feedbackText.set('');
  }
}
