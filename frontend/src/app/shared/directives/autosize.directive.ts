import { Directive, ElementRef, HostListener, type OnInit, inject, input } from '@angular/core';

@Directive({
  selector: 'textarea[rdAutosize]',
  standalone: true,
})
export class AutosizeDirective implements OnInit {
  private readonly el = inject<ElementRef<HTMLTextAreaElement>>(ElementRef);
  readonly maxHeight = input<number>(160);
  readonly maxRows = input<number>(6);

  ngOnInit(): void {
    this.resize();
  }

  @HostListener('input')
  onInput(): void {
    this.resize();
  }

  resize(): void {
    const textarea = this.el.nativeElement;
    textarea.style.height = 'auto';
    const maxPx = Math.min(this.maxHeight(), this.maxRows() * 24 + 16);
    const nextHeight = Math.min(textarea.scrollHeight, maxPx);
    textarea.style.height = `${Math.max(36, nextHeight)}px`;
  }
}
