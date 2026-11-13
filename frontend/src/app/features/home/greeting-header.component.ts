import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AuthStore } from '../../core/auth/auth.store';
import { StudioStoreService } from '../../core/state/studio-store.service';

@Component({
  selector: 'rd-greeting-header',
  standalone: true,
  imports: [],
  templateUrl: './greeting-header.component.html',
  styleUrl: './greeting-header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GreetingHeaderComponent {
  readonly store = inject(StudioStoreService);
  private readonly auth = inject(AuthStore);

  readonly firstName = computed(() => {
    const name = this.auth.user()?.displayName?.trim();
    if (!name) return 'Operator';
    return name.split(/\s+/)[0] || name;
  });

  readonly greetingPrefix = computed(() => {
    const h = new Date().getHours();
    if (h < 5) return 'Up late, ';
    if (h < 12) return 'Good morning, ';
    if (h < 18) return 'Good afternoon, ';
    return 'Good evening, ';
  });
  readonly greeting = computed(() => `${this.greetingPrefix()}${this.firstName()}`);
  readonly dateLine = computed(() => {
    const now = new Date();
    const datePart = new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(now);
    const timePart = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(now);
    return `${datePart} · ${timePart}`;
  });

  readonly needsYouCount = computed(() => {
    const n = this.store.counts().needsYou;
    return n > 0 ? Math.min(n, 4) : 4;
  });
  readonly needsYouLabel = computed(() => `${this.needsYouCount()} need you`);
  readonly workingLabel = computed(() => `${this.store.counts().working} working`);
  readonly queuedLabel = computed(() => `${this.store.counts().queued} queued`);
}
