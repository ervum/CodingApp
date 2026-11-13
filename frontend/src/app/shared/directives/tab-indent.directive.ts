import { Directive, ElementRef, HostListener, inject } from '@angular/core';

@Directive({
  selector: 'textarea[rdTabIndent]',
  standalone: true,
})
export class TabIndentDirective {
  private readonly el = inject<ElementRef<HTMLTextAreaElement>>(ElementRef);

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const textarea = this.el.nativeElement;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const value = textarea.value;

    if (event.shiftKey) {
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      if (value.slice(lineStart, lineStart + 2) === '  ') {
        textarea.value = value.slice(0, lineStart) + value.slice(lineStart + 2);
        textarea.selectionStart = Math.max(lineStart, start - 2);
        textarea.selectionEnd = Math.max(lineStart, end - 2);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return;
    }

    textarea.value = `${value.slice(0, start)}  ${value.slice(end)}`;
    textarea.selectionStart = start + 2;
    textarea.selectionEnd = start + 2;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
