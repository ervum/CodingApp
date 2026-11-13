import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  output,
  signal,
} from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import { StudioApiService } from '../../core/api/studio-api.service';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { DialogComponent } from '../../shared/ui/dialog/dialog.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ToastService } from '../../shared/ui/toast/toast.service';

const ROUTE_TITLES: Record<string, string> = {
  home: 'Home',
  lead: 'Lead',
  team: 'Team',
  tasks: 'Tasks',
  review: 'Review',
  games: 'Games',
  pitches: 'Pitches',
  market: 'Market',
  library: 'Library',
  settings: 'Settings',
};

@Component({
  selector: 'rd-context-bar',
  standalone: true,
  imports: [IconComponent, DialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './context-bar.component.html',
  styleUrl: './context-bar.component.scss',
})
export class ContextBarComponent {
  readonly store = inject(StudioStoreService);
  private readonly studioApi = inject(StudioApiService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly openAsk = output<void>();
  readonly openNewTask = output<void>();
  readonly toggleMobileMenu = output<void>();

  readonly confirmPauseOpen = signal(false);
  readonly busy = signal(false);
  readonly viewTitle = signal<string>(this.resolveTitle(this.router.url));

  constructor() {
    const sub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        this.viewTitle.set(this.resolveTitle(e.urlAfterRedirects));
      });
    this.destroyRef.onDestroy(() => sub.unsubscribe());
  }

  private resolveTitle(url: string): string {
    const clean = url.split('?')[0] ?? '';
    const parts = clean.split('/').filter(Boolean);
    const sIdx = parts.indexOf('s');
    const seg = sIdx >= 0 && parts.length > sIdx + 2 ? parts[sIdx + 2] : parts[parts.length - 1];
    return (seg && ROUTE_TITLES[seg]) || 'Home';
  }

  async refresh(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.store.reloadSnapshot();
      this.toast.info('Refreshed studio snapshot');
    } finally {
      this.busy.set(false);
    }
  }

  async onPauseOrResumeClick(): Promise<void> {
    if (this.store.isPaused()) {
      await this.resumeAll();
    } else {
      this.confirmPauseOpen.set(true);
    }
  }

  async confirmPauseAll(): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId || this.busy()) return;
    this.busy.set(true);
    try {
      const updated = await firstValueFrom(this.studioApi.pause(studioId));
      this.store.studio.set(updated);
      this.confirmPauseOpen.set(false);
      this.toast.warning('Paused all studio agents');
    } finally {
      this.busy.set(false);
    }
  }

  async resumeAll(): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId || this.busy()) return;
    this.busy.set(true);
    try {
      const updated = await firstValueFrom(this.studioApi.resume(studioId));
      this.store.studio.set(updated);
      this.toast.success('Resumed studio agents');
    } finally {
      this.busy.set(false);
    }
  }
}
