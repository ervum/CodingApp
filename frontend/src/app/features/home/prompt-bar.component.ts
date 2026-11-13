import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { StudioApiService } from '../../core/api/studio-api.service';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ToastService } from '../../shared/ui/toast/toast.service';

@Component({
  selector: 'rd-prompt-bar',
  standalone: true,
  imports: [FormsModule, IconComponent],
  templateUrl: './prompt-bar.component.html',
  styleUrl: './prompt-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromptBarComponent {
  readonly store = inject(StudioStoreService);
  private readonly studioApi = inject(StudioApiService);
  private readonly toast = inject(ToastService);

  readonly placeholder = input('Ask the Lead anything, or say what you want done...');
  readonly disabled = input(false);
  readonly submitted = output<string>();

  readonly text = signal('');
  readonly focused = signal(false);
  readonly pausing = signal(false);

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (!event.shiftKey || event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.submit();
    }
  }

  submit(): void {
    const trimmed = this.text().trim();
    if (!trimmed || this.disabled()) return;
    this.submitted.emit(trimmed);
    this.text.set('');
  }

  openNewTask(): void {
    this.store.openNewTaskModal();
  }

  async togglePauseAll(): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId || this.pausing()) return;
    this.pausing.set(true);
    try {
      if (this.store.isPaused()) {
        const updated = await firstValueFrom(this.studioApi.resume(studioId));
        this.store.studio.set(updated);
        this.toast.success('Resumed all studio agents');
      } else {
        const updated = await firstValueFrom(this.studioApi.pause(studioId));
        this.store.studio.set(updated);
        this.toast.warning('Paused all studio agents');
      }
    } finally {
      this.pausing.set(false);
    }
  }
}
