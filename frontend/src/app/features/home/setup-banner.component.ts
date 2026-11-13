import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';

@Component({
  selector: 'rd-setup-banner',
  standalone: true,
  imports: [RouterLink, IconComponent],
  templateUrl: './setup-banner.component.html',
  styleUrl: './setup-banner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetupBannerComponent {
  readonly store = inject(StudioStoreService);

  readonly visible = computed(() => {
    const s = this.store.setup();
    return !s.hasAnyLlmConnection || s.unboundAgentKeys.length > 0;
  });

  readonly headline = computed(() => {
    const s = this.store.setup();
    if (!s.hasAnyLlmConnection) {
      return 'Connect a model provider to wake your team';
    }
    const n = s.unboundAgentKeys.length;
    return `${n} agent${n === 1 ? ' has' : 's have'} no model`;
  });

  readonly detail = computed(() => {
    const s = this.store.setup();
    if (!s.hasAnyLlmConnection) {
      return 'Add an OpenAI, Anthropic, Google Gemini, xAI, or Ollama connection so agents can execute live tasks.';
    }
    return 'Bind all 15 specialist agents to a verified model connection in Settings.';
  });

  readonly settingsRoute = computed(() => [
    '/s',
    this.store.studio()?.slug ?? 'inclined-games',
    'settings',
  ]);
}
