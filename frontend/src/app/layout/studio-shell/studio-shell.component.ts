import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { HotkeysService } from '../../core/keyboard/hotkeys.service';
import { WebMcpBridgeService } from '../../core/mcp/web-mcp-bridge.service';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { EmptyStateComponent } from '../../shared/ui/empty-state/empty-state.component';
import { CommandPaletteComponent } from '../command-palette/command-palette.component';
import { ContextBarComponent } from '../context-bar/context-bar.component';
import { AskDialogComponent } from '../dialogs/ask-dialog.component';
import { NewTaskDialogComponent } from '../dialogs/new-task-dialog.component';
import { SidebarComponent } from '../sidebar/sidebar.component';

@Component({
  selector: 'rd-studio-shell',
  standalone: true,
  imports: [
    RouterOutlet,
    SidebarComponent,
    ContextBarComponent,
    CommandPaletteComponent,
    AskDialogComponent,
    NewTaskDialogComponent,
    EmptyStateComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './studio-shell.component.html',
  styleUrl: './studio-shell.component.scss',
})
export class StudioShellComponent {
  readonly store = inject(StudioStoreService);
  private readonly hotkeys = inject(HotkeysService);
  private readonly mcpBridge = inject(WebMcpBridgeService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly mobileSidebarOpen = signal(false);
  readonly paletteOpen = signal(false);
  readonly askOpen = signal(false);
  readonly newTaskOpen = signal(false);

  constructor() {
    void this.mcpBridge.init();
    const cleanups: Array<() => void> = [];

    cleanups.push(
      this.hotkeys.register('mod+k', () => {
        this.paletteOpen.update((v) => !v);
      }),
    );

    cleanups.push(
      this.hotkeys.register(
        'n',
        () => {
          this.store.openNewTaskModal();
        },
        { when: () => this.store.canEdit() && !this.paletteOpen() },
      ),
    );

    const navMap: Record<string, string> = {
      'g h': 'home',
      'g l': 'lead',
      'g t': 'team',
      'g r': 'review',
      'g p': 'pitches',
      'g m': 'market',
      'g b': 'library',
      'g s': 'settings',
    };

    for (const [combo, segment] of Object.entries(navMap)) {
      cleanups.push(
        this.hotkeys.register(combo, () => {
          const slug = this.store.studio()?.slug ?? 'inclined-games';
          void this.router.navigate(['/s', slug, segment]);
        }),
      );
    }

    this.destroyRef.onDestroy(() => {
      for (const fn of cleanups) fn();
    });
  }

  async retryLoad(): Promise<void> {
    await this.store.reloadSnapshot();
  }
}
