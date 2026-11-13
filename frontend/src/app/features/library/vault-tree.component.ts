import {
  ChangeDetectionStrategy,
  Component,
  type OnChanges,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { VaultTreeNodeDto } from '@robdev/shared';
import { DialogComponent } from '../../shared/ui/dialog/dialog.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { VaultTreeNodeComponent } from './vault-tree-node.component';

const STORAGE_KEY = 'rd.vault.expanded';

@Component({
  selector: 'rd-vault-tree',
  standalone: true,
  imports: [FormsModule, DialogComponent, IconComponent, VaultTreeNodeComponent],
  templateUrl: './vault-tree.component.html',
  styleUrl: './vault-tree.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VaultTreeComponent implements OnChanges {
  readonly nodes = input.required<VaultTreeNodeDto[]>();
  readonly selectedDocId = input<string | null>(null);
  readonly canWrite = input(false);

  readonly openDoc = output<string>();
  readonly createDoc = output<{ folderId: string; title: string }>();
  readonly createFolder = output<{ parentId: string | null; name: string }>();

  readonly filter = signal('');
  readonly expanded = signal<ReadonlySet<string>>(this.loadPersistedExpanded());

  readonly newDocDialogOpen = signal(false);
  readonly newDocFolderId = signal('');
  readonly newDocTitle = signal('');

  readonly newFolderDialogOpen = signal(false);
  readonly newFolderName = signal('');

  readonly folders = computed(() => {
    const out: Array<{ id: string; name: string }> = [];
    const walk = (list: VaultTreeNodeDto[]): void => {
      for (const n of list) {
        if (n.type === 'folder') {
          out.push({ id: n.id, name: n.path });
          if (n.children) walk(n.children);
        }
      }
    };
    walk(this.nodes());
    return out;
  });

  readonly filteredNodes = computed<VaultTreeNodeDto[]>(() => {
    const q = this.filter().trim().toLowerCase();
    if (!q) return this.nodes();

    const filterTree = (list: VaultTreeNodeDto[]): VaultTreeNodeDto[] => {
      const result: VaultTreeNodeDto[] = [];
      for (const n of list) {
        if (n.type === 'document') {
          if (n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q)) {
            result.push(n);
          }
        } else {
          const children = n.children ? filterTree(n.children) : [];
          if (n.name.toLowerCase().includes(q) || children.length > 0) {
            result.push({ ...n, children });
          }
        }
      }
      return result;
    };
    return filterTree(this.nodes());
  });

  ngOnChanges(): void {
    const current = this.expanded();
    if (current.size === 0 && this.nodes().length > 0) {
      const allFolders = new Set<string>();
      for (const n of this.nodes()) {
        if (n.type === 'folder') allFolders.add(n.id);
      }
      this.expanded.set(allFolders);
      this.persistExpanded(allFolders);
    }
    if (!this.newDocFolderId() && this.folders().length > 0) {
      this.newDocFolderId.set(this.folders()[0]?.id ?? '');
    }
  }

  onToggleFolder(folderId: string): void {
    const next = new Set(this.expanded());
    if (next.has(folderId)) {
      next.delete(folderId);
    } else {
      next.add(folderId);
    }
    this.expanded.set(next);
    this.persistExpanded(next);
  }

  openNewDocDialog(): void {
    if (!this.newDocFolderId() && this.folders().length > 0) {
      this.newDocFolderId.set(this.folders()[0]?.id ?? '');
    }
    this.newDocTitle.set('');
    this.newDocDialogOpen.set(true);
  }

  submitNewDoc(): void {
    const folderId = this.newDocFolderId();
    const title = this.newDocTitle().trim();
    if (!folderId || !title) return;
    this.createDoc.emit({ folderId, title });
    this.newDocDialogOpen.set(false);
  }

  submitNewFolder(): void {
    const name = this.newFolderName().trim();
    if (!name) return;
    this.createFolder.emit({ parentId: null, name });
    this.newFolderDialogOpen.set(false);
    this.newFolderName.set('');
  }

  private loadPersistedExpanded(): ReadonlySet<string> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((x): x is string => typeof x === 'string'));
      }
    } catch {
      // ignore storage errors
    }
    return new Set();
  }

  private persistExpanded(set: ReadonlySet<string>): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
    } catch {
      // ignore storage errors
    }
  }
}
