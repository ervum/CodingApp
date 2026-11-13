import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
}

@Component({
  selector: 'rd-kbd',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './kbd.component.scss',
  template: `
    @for (k of displayKeys(); track $index) {
      <kbd class="rd-kbd">{{ k }}</kbd>
    }
  `,
})
export class KbdComponent {
  readonly keys = input.required<string[]>();
  private readonly mac = isMacPlatform();

  readonly displayKeys = computed(() =>
    this.keys().map((k) => (this.mac && k.toLowerCase() === 'ctrl' ? '⌘' : k)),
  );
}
