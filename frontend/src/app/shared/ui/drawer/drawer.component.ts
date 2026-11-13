import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  effect,
  inject,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';
import { HotkeysService } from '../../../core/keyboard/hotkeys.service';

@Component({
  selector: 'rd-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './drawer.component.html',
  styleUrl: './drawer.component.scss',
  host: {
    '[class.is-open]': 'open()',
  },
})
export class DrawerComponent {
  private readonly doc = inject(DOCUMENT);
  private readonly hotkeys = inject(HotkeysService);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = model<boolean>(false);
  readonly label = input.required<string>();
  readonly closed = output<void>();

  private readonly panelRef = viewChild<ElementRef<HTMLElement>>('panel');
  private previousFocused: HTMLElement | null = null;

  constructor() {
    const unregister = this.hotkeys.register(
      'esc',
      () => {
        this.close();
      },
      { when: () => this.open(), allowInInput: true },
    );
    this.destroyRef.onDestroy(unregister);

    effect(() => {
      if (this.open()) {
        this.previousFocused = this.doc.activeElement as HTMLElement | null;
        setTimeout(() => {
          this.panelRef()?.nativeElement.focus();
        }, 0);
      } else if (this.previousFocused) {
        this.previousFocused.focus();
        this.previousFocused = null;
      }
    });
  }

  close(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.closed.emit();
  }
}
