import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import type { IconName } from '../icon/icons';

@Component({
  selector: 'rd-empty-state',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './empty-state.component.scss',
  template: `
    <div class="empty">
      @if (icon()) {
        <div class="empty__icon">
          <rd-icon [name]="icon()!" [size]="22" />
        </div>
      }
      <h3 class="empty__title">{{ title() }}</h3>
      @if (description()) {
        <p class="empty__desc">{{ description() }}</p>
      }
      <div class="empty__actions">
        @if (actionLabel()) {
          <button type="button" class="rd-btn rd-btn--primary rd-btn--sm" (click)="action.emit()">
            {{ actionLabel() }}
          </button>
        }
        <ng-content />
      </div>
    </div>
  `,
})
export class EmptyStateComponent {
  readonly icon = input<IconName>();
  readonly title = input.required<string>();
  readonly description = input<string>();
  readonly actionLabel = input<string>('');
  readonly action = output<void>();
}
