import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { BlockerDto, BlockerSeverity, StagePayload } from '@robdev/shared';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { StatusPillComponent } from '../../shared/ui/status-pill/status-pill.component';

const SEVERITY_ORDER: Record<BlockerSeverity, number> = {
  FIX_FIRST: 0,
  SHOULD_FIX: 1,
  NIT: 2,
};

@Component({
  selector: 'rd-stage-detail',
  standalone: true,
  imports: [IconComponent, StatusPillComponent],
  templateUrl: './stage-detail.component.html',
  styleUrl: './stage-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StageDetailComponent {
  readonly payload = input<StagePayload | null>(null);
  readonly blockers = input.required<BlockerDto[]>();
  readonly canEdit = input(false);
  readonly resolveBlocker = output<{ id: string; status: 'RESOLVED' | 'WAIVED' }>();

  readonly sortedBlockers = computed(() =>
    [...this.blockers()].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    ),
  );
}
