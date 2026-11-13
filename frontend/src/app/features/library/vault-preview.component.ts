import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MarkdownViewComponent } from '../../shared/ui/markdown-view/markdown-view.component';

@Component({
  selector: 'rd-vault-preview',
  standalone: true,
  imports: [MarkdownViewComponent],
  templateUrl: './vault-preview.component.html',
  styleUrl: './vault-preview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VaultPreviewComponent {
  readonly markdown = input.required<string>();
  readonly resolveLink = input<(target: string) => string | null>(() => null);
  readonly wikilinkClick = output<string>();
}
