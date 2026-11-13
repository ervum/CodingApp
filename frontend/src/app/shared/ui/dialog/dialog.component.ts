import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  effect,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'rd-dialog',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dialog.component.html',
  styleUrl: './dialog.component.scss',
})
export class DialogComponent {
  readonly open = model<boolean>(false);
  readonly title = input.required<string>();
  readonly subtitle = input<string>('');
  readonly width = input<string>('520px');
  readonly closed = output<void>();

  private readonly dialogRef = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  constructor() {
    effect(() => {
      const dlg = this.dialogRef()?.nativeElement;
      if (!dlg) return;
      const shouldOpen = this.open();
      if (shouldOpen && !dlg.open) {
        if (typeof dlg.showModal === 'function') {
          dlg.showModal();
        } else {
          dlg.setAttribute('open', '');
        }
      } else if (!shouldOpen && dlg.open) {
        if (typeof dlg.close === 'function') {
          dlg.close();
        } else {
          dlg.removeAttribute('open');
        }
      }
    });
  }

  closeDialog(): void {
    this.open.set(false);
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    const dlg = this.dialogRef()?.nativeElement;
    if (dlg && event.target === dlg) {
      this.closeDialog();
    }
  }

  onNativeClose(): void {
    if (this.open()) {
      this.open.set(false);
      this.closed.emit();
    }
  }
}
