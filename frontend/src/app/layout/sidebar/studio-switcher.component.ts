import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { StudioApiService } from '../../core/api/studio-api.service';
import { AuthStore } from '../../core/auth/auth.store';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { DialogComponent } from '../../shared/ui/dialog/dialog.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ToastService } from '../../shared/ui/toast/toast.service';

@Component({
  selector: 'rd-studio-switcher',
  standalone: true,
  imports: [FormsModule, IconComponent, DialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './studio-switcher.component.html',
  styleUrl: './studio-switcher.component.scss',
})
export class StudioSwitcherComponent {
  readonly auth = inject(AuthStore);
  readonly store = inject(StudioStoreService);
  private readonly studioApi = inject(StudioApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly menuOpen = signal(false);
  readonly createOpen = signal(false);
  readonly newStudioName = signal('');
  readonly creating = signal(false);

  readonly label = computed(
    () => this.store.studio()?.workspaceLabel ?? 'robdev / Inclined Games studio',
  );

  toggleMenu(): void {
    this.menuOpen.update((v) => !v);
  }

  closeMenu(): void {
    this.menuOpen.set(false);
  }

  async switchStudio(slug: string): Promise<void> {
    this.menuOpen.set(false);
    await this.router.navigate(['/s', slug, 'home']);
  }

  openCreateDialog(): void {
    this.menuOpen.set(false);
    this.newStudioName.set('');
    this.createOpen.set(true);
  }

  async createStudio(): Promise<void> {
    const name = this.newStudioName().trim();
    if (name.length < 2 || this.creating()) return;
    this.creating.set(true);
    try {
      const slug =
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'studio';
      const created = await firstValueFrom(this.studioApi.create({ name, slug }));
      this.auth.memberships.update((list) => [
        ...list,
        {
          studioId: created.id,
          studioSlug: created.slug,
          studioName: created.name,
          workspaceLabel: created.workspaceLabel,
          role: created.role,
        },
      ]);
      this.createOpen.set(false);
      this.toast.success(`Created ${created.name} studio`);
      await this.router.navigate(['/s', created.slug, 'home']);
    } finally {
      this.creating.set(false);
    }
  }

  async logout(): Promise<void> {
    this.menuOpen.set(false);
    this.store.deactivate();
    await this.auth.logout();
  }
}
