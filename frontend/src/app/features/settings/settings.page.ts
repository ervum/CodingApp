import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import type { LlmConnectionDto } from '@robdev/shared';
import { AgentModelBindingsComponent } from './agent-model-bindings.component';
import { McpServerPanelComponent } from './mcp-server-panel.component';
import { MembersComponent } from './members.component';
import { ModelConnectionsComponent } from './model-connections.component';

@Component({
  selector: 'rd-settings-page',
  standalone: true,
  imports: [
    ModelConnectionsComponent,
    AgentModelBindingsComponent,
    McpServerPanelComponent,
    MembersComponent,
  ],
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPage {
  readonly connections = signal<LlmConnectionDto[]>([]);
}
