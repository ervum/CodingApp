import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
  output,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TabIndentDirective } from '../../shared/directives/tab-indent.directive';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import type { LibraryMode, SaveState } from './library.store';

@Component({
  selector: 'rd-vault-editor',
  standalone: true,
  imports: [FormsModule, TabIndentDirective, IconComponent],
  templateUrl: './vault-editor.component.html',
  styleUrl: './vault-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VaultEditorComponent {
  readonly text = model.required<string>();
  readonly title = model.required<string>();
  readonly saveState = input.required<SaveState>();
  readonly version = input(1);
  readonly readonly = input(false);
  readonly mode = model<LibraryMode>('split');
  readonly conflictVersion = input<number | null>(null);

  readonly save = output<void>();
  readonly resolveConflict = output<'mine' | 'theirs'>();

  readonly saveLabel = computed(() => {
    switch (this.saveState()) {
      case 'saved':
        return `Saved v${this.version()}`;
      case 'dirty':
        return 'Unsaved';
      case 'saving':
        return 'Saving…';
      case 'conflict':
        return 'Conflict';
      case 'error':
        return 'Save error';
    }
  });

  onKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.save.emit();
    }
  }
}
