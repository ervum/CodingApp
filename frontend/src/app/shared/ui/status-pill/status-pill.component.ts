import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export const STATUS_LABELS: Record<string, string> = {
  WORKING: 'WORKING',
  IDLE: 'IDLE',
  WAITING_ON_HUMAN: 'WAITING',
  BLOCKED: 'BLOCKED',
  PAUSED: 'PAUSED',
  ERROR: 'ERROR',
  OFFLINE: 'OFFLINE',
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  NEEDS_HUMAN: 'NEEDS YOU',
  DONE: 'DONE',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  TO_REVIEW: 'TO REVIEW',
  CHANGES_ASKED: 'CHANGES ASKED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  FIX_FIRST: 'FIX FIRST',
  SHOULD_FIX: 'SHOULD FIX',
  NIT: 'NIT',
};

@Component({
  selector: 'rd-status-pill',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './status-pill.component.scss',
  host: {
    '[attr.data-status]': 'status()',
  },
  template: `<span class="pill">{{ resolvedLabel() }}</span>`,
})
export class StatusPillComponent {
  readonly status = input.required<string>();
  readonly label = input<string>();
  readonly resolvedLabel = computed(
    () => this.label() ?? STATUS_LABELS[this.status()] ?? this.status(),
  );
}
