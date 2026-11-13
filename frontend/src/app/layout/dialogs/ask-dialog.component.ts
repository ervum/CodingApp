import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  model,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AgentsApiService } from '../../core/api/agents-api.service';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { DialogComponent } from '../../shared/ui/dialog/dialog.component';
import { ToastService } from '../../shared/ui/toast/toast.service';

@Component({
  selector: 'rd-ask-dialog',
  standalone: true,
  imports: [FormsModule, DialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ask-dialog.component.html',
  styleUrl: './ask-dialog.component.scss',
})
export class AskDialogComponent {
  readonly store = inject(StudioStoreService);
  private readonly agentsApi = inject(AgentsApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly open = model<boolean>(false);
  readonly prompt = signal('');
  readonly gameId = signal<string>('');
  readonly submitting = signal(false);

  constructor() {
    effect(() => {
      if (this.open()) {
        this.prompt.set('');
        const sel = this.store.selectedGameId();
        this.gameId.set(sel === 'all' ? '' : sel);
      }
    });
  }

  async submit(): Promise<void> {
    const studio = this.store.studio();
    const promptText = this.prompt().trim();
    if (!studio || promptText.length < 3 || this.submitting()) return;
    this.submitting.set(true);
    try {
      await firstValueFrom(
        this.agentsApi.askLead(studio.id, {
          prompt: promptText,
          gameId: this.gameId() || null,
        }),
      );
      this.open.set(false);
      this.toast.success('Sent to Lead');
      await this.router.navigate(['/s', studio.slug, 'lead']);
    } finally {
      this.submitting.set(false);
    }
  }
}
