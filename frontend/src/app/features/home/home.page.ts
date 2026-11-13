import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AgentsApiService } from '../../core/api/agents-api.service';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { GreetingHeaderComponent } from './greeting-header.component';
import { LiveNowPanelComponent } from './live-now-panel.component';
import { NeedsYouColumnComponent } from './needs-you-column.component';
import { PromptBarComponent } from './prompt-bar.component';

@Component({
  selector: 'rd-home-page',
  standalone: true,
  imports: [
    GreetingHeaderComponent,
    PromptBarComponent,
    NeedsYouColumnComponent,
    LiveNowPanelComponent,
  ],
  templateUrl: './home.page.html',
  styleUrl: './home.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage {
  readonly store = inject(StudioStoreService);
  private readonly agentsApi = inject(AgentsApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly busy = signal(false);

  async onPromptSubmit(prompt: string): Promise<void> {
    const studio = this.store.studio();
    if (!studio || this.busy()) return;
    this.busy.set(true);
    try {
      const sel = this.store.selectedGameId();
      await firstValueFrom(
        this.agentsApi.askLead(studio.id, {
          prompt,
          gameId: sel === 'all' ? null : sel,
        }),
      );
      this.toast.success('Sent to Lead');
      await this.router.navigate(['/s', studio.slug, 'lead']);
    } catch {
      this.toast.error('Failed to send prompt to Lead');
    } finally {
      this.busy.set(false);
    }
  }
}
