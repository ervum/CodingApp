import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type { VaultTreeNodeDto } from '@robdev/shared';
import { IconComponent } from '../../shared/ui/icon/icon.component';

@Component({
  selector: 'rd-vault-tree-node',
  standalone: true,
  imports: [DecimalPipe, IconComponent, VaultTreeNodeComponent],
  templateUrl: './vault-tree-node.component.html',
  styleUrl: './vault-tree-node.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VaultTreeNodeComponent {
  readonly node = input.required<VaultTreeNodeDto>();
  readonly depth = input(0);
  readonly selectedDocId = input<string | null>(null);
  readonly expanded = input<ReadonlySet<string>>(new Set());

  readonly toggle = output<string>();
  readonly openDoc = output<string>();

  readonly isFolder = computed(() => this.node().type === 'folder');
  readonly isExpanded = computed(() => this.expanded().has(this.node().id));
  readonly isSelected = computed(
    () => !this.isFolder() && this.selectedDocId() === this.node().id,
  );
  readonly indentPx = computed(() => `${this.depth() * 14 + 10}px`);

  onClick(): void {
    const n = this.node();
    if (n.type === 'folder') {
      this.toggle.emit(n.id);
    } else {
      this.openDoc.emit(n.id);
    }
  }
}
