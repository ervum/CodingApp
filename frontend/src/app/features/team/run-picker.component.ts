import { ChangeDetectionStrategy, Component, input, model, output } from '@angular/core';
import type { AgentRunSummaryDto } from '@robdev/shared';
import { RelativeTimePipe } from '../../shared/pipes/relative-time.pipe';
import { IconComponent } from '../../shared/ui/icon/icon.component';

@Component({
  selector: 'rd-run-picker',
  standalone: true,
  imports: [RelativeTimePipe, IconComponent],
  templateUrl: './run-picker.component.html',
  styleUrl: './run-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RunPickerComponent {
  readonly runs = input.required<AgentRunSummaryDto[]>();
  readonly selected = model<string | null>(null);
  readonly live = input<string | null>(null);
  readonly canEdit = input<boolean>(false);

  readonly deleteRun = output<string>();
  readonly clearChatRuns = output<void>();
  readonly clearAllStudioRuns = output<void>();

  selectRun(id: string | null): void {
    this.selected.set(id);
  }

  onDeleteRun(event: MouseEvent, id: string): void {
    event.stopPropagation();
    this.deleteRun.emit(id);
  }

  statusGlyph(status: AgentRunSummaryDto['status']): string {
    switch (status) {
      case 'SUCCEEDED':
        return '✓';
      case 'FAILED':
      case 'CANCELLED':
        return '✗';
      case 'RUNNING':
        return '●';
      default:
        return '…';
    }
  }
}
