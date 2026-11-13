import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SocketService } from '../../core/realtime/socket.service';
import { StudioStoreService } from '../../core/state/studio-store.service';

@Component({
  selector: 'rd-execution-widget',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './execution-widget.component.html',
  styleUrl: './execution-widget.component.scss',
})
export class ExecutionWidgetComponent {
  readonly store = inject(StudioStoreService);
  readonly socket = inject(SocketService);
  readonly engine = signal<'claude' | 'codex'>('claude');
}
