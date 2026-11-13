import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import type {
  WorkspaceFileDetailDto,
  WorkspaceFileVersionDto,
  WorkspaceOverviewDto,
  WorkspaceTreeNodeDto,
} from '@robdev/shared';
import { firstValueFrom } from 'rxjs';
import { WorkspaceApiService } from '../../core/api/workspace-api.service';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { BytesPipe } from '../../shared/pipes/bytes.pipe';
import { RelativeTimePipe } from '../../shared/pipes/relative-time.pipe';
import { AgentAvatarComponent } from '../../shared/ui/agent-avatar/agent-avatar.component';
import { DialogComponent } from '../../shared/ui/dialog/dialog.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state/empty-state.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { LuauHighlighter } from '../../core/markdown/luau-highlighter';
import { computeLineDiff, type DiffLine } from '../../core/diff/line-diff';

export interface FlatWorkspaceTreeRow {
  node: WorkspaceTreeNodeDto;
  depth: number;
  expanded: boolean;
}

export type WorkspaceTabId = 'code' | 'diff' | 'comments' | 'info' | 'inspector';

export interface SiliconKeyVal {
  key: string;
  value: string;
}

@Component({
  selector: 'rd-workspace-page',
  standalone: true,
  imports: [
    FormsModule,
    DatePipe,
    DecimalPipe,
    BytesPipe,
    RelativeTimePipe,
    AgentAvatarComponent,
    DialogComponent,
    EmptyStateComponent,
    IconComponent,
  ],
  templateUrl: './workspace.page.html',
  styleUrl: './workspace.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspacePage {
  readonly store = inject(StudioStoreService);
  private readonly workspaceApi = inject(WorkspaceApiService);
  private readonly toast = inject(ToastService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly loadingOverview = signal<boolean>(false);
  readonly loadingFile = signal<boolean>(false);
  readonly overview = signal<WorkspaceOverviewDto | null>(null);
  readonly selectedFilePath = signal<string | null>(null);
  readonly fileDetail = signal<WorkspaceFileDetailDto | null>(null);

  readonly filterQuery = signal<string>('');
  readonly expandedFolders = signal<Set<string>>(new Set<string>());
  readonly activeTab = signal<WorkspaceTabId>('code');

  // Version & Diff state
  readonly selectedVersionNum = signal<number | null>(null);
  readonly compareBaseVersionNum = signal<number | null>(null);

  // Edit / New file state
  readonly editingMode = signal<boolean>(false);
  readonly editDraftContent = signal<string>('');
  readonly editDraftComment = signal<string>('');
  readonly savingEdit = signal<boolean>(false);

  readonly newFileDialogOpen = signal<boolean>(false);
  readonly newFilePath = signal<string>('');
  readonly newFileContent = signal<string>('');
  readonly newFileComment = signal<string>('');

  // New comment state
  readonly newCommentBody = signal<string>('');
  readonly newCommentLineStart = signal<string>('');
  readonly newCommentLineEnd = signal<string>('');
  readonly submittingComment = signal<boolean>(false);

  // Silicon DataModel Inspector state
  readonly inspectorClassName = signal<string>('Folder');
  readonly inspectorProperties = signal<SiliconKeyVal[]>([]);
  readonly inspectorAttributes = signal<SiliconKeyVal[]>([]);
  readonly inspectorTags = signal<string>('');
  readonly savingInspector = signal<boolean>(false);

  readonly copiedState = signal<boolean>(false);

  constructor() {
    effect(() => {
      const studioId = this.store.studioId();
      if (studioId) {
        void this.loadOverview();
      }
    });
  }

  readonly flatTreeRows = computed<FlatWorkspaceTreeRow[]>(() => {
    const ov = this.overview();
    if (!ov) return [];
    const q = this.filterQuery().trim().toLowerCase();
    const expanded = this.expandedFolders();
    const rows: FlatWorkspaceTreeRow[] = [];

    const matchesFilter = (node: WorkspaceTreeNodeDto): boolean => {
      if (!q) return true;
      if (
        node.path.toLowerCase().includes(q) ||
        node.name.toLowerCase().includes(q) ||
        (node.className && node.className.toLowerCase().includes(q)) ||
        (node.latestAgentComment &&
          node.latestAgentComment.toLowerCase().includes(q)) ||
        (node.lastModifiedByAgentName &&
          node.lastModifiedByAgentName.toLowerCase().includes(q))
      ) {
        return true;
      }
      if (node.kind === 'folder' && node.children) {
        return node.children.some(matchesFilter);
      }
      return false;
    };

    const visit = (nodes: WorkspaceTreeNodeDto[], depth: number) => {
      for (const node of nodes) {
        if (!matchesFilter(node)) continue;
        const isExpanded = q.length > 0 || expanded.has(node.path);
        rows.push({
          node,
          depth,
          expanded: isExpanded,
        });
        if (node.kind === 'folder' && isExpanded && node.children) {
          visit(node.children, depth + 1);
        }
      }
    };

    visit(ov.tree, 0);
    return rows;
  });

  readonly selectedVersion = computed<WorkspaceFileVersionDto | null>(() => {
    const detail = this.fileDetail();
    if (!detail || detail.versions.length === 0) return null;
    const targetNum = this.selectedVersionNum();
    return (
      detail.versions.find((v) => v.version === targetNum) ??
      detail.versions[0] ??
      null
    );
  });

  readonly compareBaseVersion = computed<WorkspaceFileVersionDto | null>(() => {
    const detail = this.fileDetail();
    const current = this.selectedVersion();
    if (!detail || !current) return null;
    const baseNum = this.compareBaseVersionNum();
    if (baseNum !== null && baseNum !== current.version) {
      const match = detail.versions.find((v) => v.version === baseNum);
      if (match) return match;
    }
    // Default to immediately preceding version (chronologically version - 1)
    const older = detail.versions.find((v) => v.version === current.version - 1);
    return older ?? detail.versions[detail.versions.length - 1] ?? null;
  });

  readonly diffLines = computed<DiffLine[]>(() => {
    const cur = this.selectedVersion();
    const base = this.compareBaseVersion();
    if (!cur) return [];
    if (!base || base.version === cur.version) {
      return computeLineDiff(cur.content, cur.content);
    }
    return computeLineDiff(base.content, cur.content);
  });

  readonly diffStats = computed(() => {
    let added = 0;
    let removed = 0;
    for (const line of this.diffLines()) {
      if (line.kind === 'add') added += 1;
      else if (line.kind === 'del') removed += 1;
    }
    return { added, removed };
  });

  readonly numberedCodeLines = computed<
    Array<{ num: number; html: SafeHtml }>
  >(() => {
    const detail = this.fileDetail();
    if (!detail) return [];
    const lines = detail.content.split(/\r?\n/);
    return lines.map((line, idx) => {
      const highlighted = LuauHighlighter.highlight(line, detail.language);
      return {
        num: idx + 1,
        html: this.sanitizer.bypassSecurityTrustHtml(highlighted || ' '),
      };
    });
  });

  highlightDiffLine(text: string): SafeHtml {
    const lang = this.fileDetail()?.language ?? 'luau';
    const highlighted = LuauHighlighter.highlight(text, lang);
    return this.sanitizer.bypassSecurityTrustHtml(highlighted || ' ');
  }

  highlightYaml(yaml: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(
      LuauHighlighter.highlight(yaml, 'yaml'),
    );
  }

  async loadOverview(preserveSelection = true): Promise<void> {
    const studioId = this.store.studioId();
    if (!studioId) return;
    this.loadingOverview.set(true);
    try {
      const data = await firstValueFrom(this.workspaceApi.getOverview(studioId));
      this.overview.set(data);

      // Expand top 3 folder levels by default on first load
      if (this.expandedFolders().size === 0) {
        const initialExpanded = new Set<string>();
        const collectInitial = (
          nodes: WorkspaceTreeNodeDto[],
          depth: number,
        ) => {
          for (const n of nodes) {
            if (n.kind === 'folder' && depth < 3) {
              initialExpanded.add(n.path);
              if (n.children) collectInitial(n.children, depth + 1);
            }
          }
        };
        collectInitial(data.tree, 0);
        this.expandedFolders.set(initialExpanded);
      }

      const currentPath = this.selectedFilePath();
      if (preserveSelection && currentPath) {
        await this.selectFile(currentPath);
      } else {
        const firstFile = this.findFirstFileInTree(data.tree);
        if (firstFile) {
          await this.selectFile(firstFile.path);
        }
      }
    } catch {
      this.toast.error('Failed to load /workspace/ hierarchy');
    } finally {
      this.loadingOverview.set(false);
    }
  }

  async selectFile(path: string): Promise<void> {
    const studioId = this.store.studioId();
    if (!studioId) return;
    this.selectedFilePath.set(path);
    this.editingMode.set(false);
    this.loadingFile.set(true);
    try {
      const detail = await firstValueFrom(
        this.workspaceApi.getFileDetail(studioId, path),
      );
      this.fileDetail.set(detail);
      this.hydrateInspectorFromDetail(detail);
      const newestVer = detail.versions[0]?.version ?? 1;
      this.selectedVersionNum.set(newestVer);
      const prevVer =
        detail.versions[1]?.version ??
        detail.versions[detail.versions.length - 1]?.version ??
        newestVer;
      this.compareBaseVersionNum.set(prevVer);
    } catch {
      this.toast.error(`Could not load workspace file "${path}"`);
    } finally {
      this.loadingFile.set(false);
    }
  }

  onTreeRowClick(row: FlatWorkspaceTreeRow): void {
    if (row.node.kind === 'folder') {
      this.toggleFolder(row.node.path);
    } else {
      void this.selectFile(row.node.path);
    }
  }

  toggleFolder(folderPath: string): void {
    this.expandedFolders.update((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  }

  expandAllFolders(): void {
    const ov = this.overview();
    if (!ov) return;
    const all = new Set<string>();
    const walk = (nodes: WorkspaceTreeNodeDto[]) => {
      for (const n of nodes) {
        if (n.kind === 'folder') {
          all.add(n.path);
          if (n.children) walk(n.children);
        }
      }
    };
    walk(ov.tree);
    this.expandedFolders.set(all);
  }

  collapseAllFolders(): void {
    this.expandedFolders.set(new Set());
  }

  startEditing(): void {
    const detail = this.fileDetail();
    if (!detail) return;
    this.editDraftContent.set(detail.content);
    this.editDraftComment.set('');
    this.editingMode.set(true);
    this.activeTab.set('code');
  }

  cancelEditing(): void {
    this.editingMode.set(false);
  }

  async saveEditedFile(): Promise<void> {
    const studioId = this.store.studioId();
    const detail = this.fileDetail();
    if (!studioId || !detail || this.savingEdit()) return;
    this.savingEdit.set(true);
    try {
      const updated = await firstValueFrom(
        this.workspaceApi.saveFile(studioId, {
          path: detail.path,
          content: this.editDraftContent(),
          language: detail.language,
          comment:
            this.editDraftComment().trim() || 'Edited in Workspace Explorer',
        }),
      );
      this.fileDetail.set(updated);
      this.editingMode.set(false);
      this.selectedVersionNum.set(updated.versions[0]?.version ?? 1);
      this.toast.success(`Saved ${detail.path}`);
      await this.loadOverview(true);
    } catch {
      this.toast.error('Failed to save workspace file');
    } finally {
      this.savingEdit.set(false);
    }
  }

  async restoreVersion(ver: WorkspaceFileVersionDto): Promise<void> {
    const studioId = this.store.studioId();
    const detail = this.fileDetail();
    if (!studioId || !detail || this.savingEdit()) return;
    this.savingEdit.set(true);
    try {
      const updated = await firstValueFrom(
        this.workspaceApi.saveFile(studioId, {
          path: detail.path,
          content: ver.content,
          language: detail.language,
          comment: `Restored v${ver.version} in Workspace Explorer`,
        }),
      );
      this.fileDetail.set(updated);
      this.selectedVersionNum.set(updated.versions[0]?.version ?? 1);
      this.toast.success(`Restored ${detail.path} to v${ver.version}`);
      await this.loadOverview(true);
    } catch {
      this.toast.error('Failed to restore version');
    } finally {
      this.savingEdit.set(false);
    }
  }

  openNewFileDialog(): void {
    this.newFilePath.set('');
    this.newFileContent.set('');
    this.newFileComment.set('');
    this.newFileDialogOpen.set(true);
  }

  async submitNewFile(): Promise<void> {
    const studioId = this.store.studioId();
    const path = this.newFilePath().trim();
    if (!studioId || !path || this.savingEdit()) return;
    this.savingEdit.set(true);
    try {
      await firstValueFrom(
        this.workspaceApi.saveFile(studioId, {
          path,
          content: this.newFileContent(),
          comment:
            this.newFileComment().trim() || 'Created in Workspace Explorer',
        }),
      );
      this.newFileDialogOpen.set(false);
      this.selectedFilePath.set(path);
      this.toast.success(`Created /workspace/${path}`);
      await this.loadOverview(true);
    } catch {
      this.toast.error('Failed to create workspace file');
    } finally {
      this.savingEdit.set(false);
    }
  }

  async submitComment(): Promise<void> {
    const studioId = this.store.studioId();
    const detail = this.fileDetail();
    const body = this.newCommentBody().trim();
    if (!studioId || !detail || !body || this.submittingComment()) return;

    const lineStartNum = parseInt(this.newCommentLineStart(), 10);
    const lineEndNum = parseInt(this.newCommentLineEnd(), 10);

    this.submittingComment.set(true);
    try {
      await firstValueFrom(
        this.workspaceApi.addComment(studioId, {
          path: detail.path,
          body,
          lineStart: Number.isFinite(lineStartNum) && lineStartNum > 0 ? lineStartNum : null,
          lineEnd: Number.isFinite(lineEndNum) && lineEndNum > 0 ? lineEndNum : null,
        }),
      );
      this.newCommentBody.set('');
      this.newCommentLineStart.set('');
      this.newCommentLineEnd.set('');
      this.toast.success('Added comment to file');
      await this.selectFile(detail.path);
    } catch {
      this.toast.error('Failed to add comment');
    } finally {
      this.submittingComment.set(false);
    }
  }

  copyCurrentContent(): void {
    const detail = this.fileDetail();
    if (!detail) return;
    void navigator.clipboard?.writeText(detail.content);
    this.copiedState.set(true);
    setTimeout(() => this.copiedState.set(false), 1800);
  }

  downloadCurrentFile(): void {
    const detail = this.fileDetail();
    if (!detail) return;
    const blob = new Blob([detail.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = detail.name || 'artifact.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  addInspectorProperty(): void {
    this.inspectorProperties.update((list) => [...list, { key: '', value: '' }]);
  }

  removeInspectorProperty(index: number): void {
    this.inspectorProperties.update((list) => list.filter((_, i) => i !== index));
  }

  updateInspectorPropertyKey(index: number, key: string): void {
    this.inspectorProperties.update((list) =>
      list.map((item, i) => (i === index ? { ...item, key } : item)),
    );
  }

  updateInspectorPropertyValue(index: number, value: string): void {
    this.inspectorProperties.update((list) =>
      list.map((item, i) => (i === index ? { ...item, value } : item)),
    );
  }

  addInspectorAttribute(): void {
    this.inspectorAttributes.update((list) => [...list, { key: '', value: '' }]);
  }

  removeInspectorAttribute(index: number): void {
    this.inspectorAttributes.update((list) => list.filter((_, i) => i !== index));
  }

  updateInspectorAttributeKey(index: number, key: string): void {
    this.inspectorAttributes.update((list) =>
      list.map((item, i) => (i === index ? { ...item, key } : item)),
    );
  }

  updateInspectorAttributeValue(index: number, value: string): void {
    this.inspectorAttributes.update((list) =>
      list.map((item, i) => (i === index ? { ...item, value } : item)),
    );
  }

  async saveInspectorYaml(): Promise<void> {
    const studioId = this.store.studioId();
    const detail = this.fileDetail();
    if (!studioId || !detail || this.savingInspector()) return;

    const isDirectProps = detail.name.toLowerCase() === 'properties.yaml';
    const dir = detail.path.includes('/')
      ? detail.path.slice(0, detail.path.lastIndexOf('/'))
      : '';
    const targetPath = isDirectProps
      ? detail.path
      : dir
        ? `${dir}/Properties.yaml`
        : 'Properties.yaml';

    const lines: string[] = [];
    lines.push(`ClassName: ${this.inspectorClassName().trim() || 'Folder'}`);

    const props = this.inspectorProperties().filter((p) => p.key.trim().length > 0);
    if (props.length > 0) {
      lines.push('Properties:');
      for (const p of props) {
        lines.push(`  ${p.key.trim()}: ${p.value.trim()}`);
      }
    }

    const attrs = this.inspectorAttributes().filter((a) => a.key.trim().length > 0);
    if (attrs.length > 0) {
      lines.push('Attributes:');
      for (const a of attrs) {
        lines.push(`  ${a.key.trim()}: ${a.value.trim()}`);
      }
    }

    const tags = this.inspectorTags()
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (tags.length > 0) {
      lines.push('Tags:');
      for (const tag of tags) {
        lines.push(`  - ${tag}`);
      }
    }

    const yamlContent = `${lines.join('\n')}\n`;
    this.savingInspector.set(true);
    try {
      await firstValueFrom(
        this.workspaceApi.saveFile(studioId, {
          path: targetPath,
          content: yamlContent,
          language: 'yaml',
          comment: 'Updated in Silicon DataModel Inspector',
        }),
      );
      this.toast.success(`Saved Silicon properties to ${targetPath}`);
      await this.loadOverview(true);
    } catch {
      this.toast.error('Failed to save Properties.yaml');
    } finally {
      this.savingInspector.set(false);
    }
  }

  private hydrateInspectorFromDetail(detail: WorkspaceFileDetailDto): void {
    const rawYaml =
      detail.name.toLowerCase() === 'properties.yaml'
        ? detail.content
        : detail.misc.companionPropertiesYaml ?? '';

    let className = detail.misc.className ?? 'Folder';
    const props: SiliconKeyVal[] = [];
    const attrs: SiliconKeyVal[] = [];
    const tags: string[] = [];

    if (rawYaml) {
      let section: 'root' | 'properties' | 'attributes' | 'tags' = 'root';
      for (const rawLine of rawYaml.split(/\r?\n/)) {
        const trimmed = rawLine.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const indent = rawLine.search(/\S/);
        if (indent === 0) {
          if (trimmed.startsWith('ClassName:')) {
            className = trimmed.slice('ClassName:'.length).trim() || className;
            section = 'root';
          } else if (trimmed.startsWith('Properties:')) {
            section = 'properties';
          } else if (trimmed.startsWith('Attributes:')) {
            section = 'attributes';
          } else if (trimmed.startsWith('Tags:')) {
            section = 'tags';
          } else {
            const sep = trimmed.indexOf(':');
            if (sep > 0) {
              props.push({
                key: trimmed.slice(0, sep).trim(),
                value: trimmed.slice(sep + 1).trim(),
              });
            }
          }
        } else if (section === 'properties' || section === 'attributes') {
          const sep = trimmed.indexOf(':');
          if (sep > 0) {
            const kv = {
              key: trimmed.slice(0, sep).trim(),
              value: trimmed.slice(sep + 1).trim(),
            };
            if (section === 'properties') props.push(kv);
            else attrs.push(kv);
          }
        } else if (section === 'tags' && trimmed.startsWith('-')) {
          const t = trimmed.slice(1).trim();
          if (t) tags.push(t);
        }
      }
    }

    this.inspectorClassName.set(className);
    this.inspectorProperties.set(props);
    this.inspectorAttributes.set(attrs);
    this.inspectorTags.set(tags.join(', '));
  }

  private findFirstFileInTree(
    nodes: WorkspaceTreeNodeDto[],
  ): WorkspaceTreeNodeDto | null {
    for (const n of nodes) {
      if (n.kind === 'file' && n.name.toLowerCase() !== 'properties.yaml') {
        return n;
      }
      if (n.kind === 'folder' && n.children) {
        const found = this.findFirstFileInTree(n.children);
        if (found) return found;
      }
    }
    for (const n of nodes) {
      if (n.kind === 'file') return n;
      if (n.kind === 'folder' && n.children) {
        const found = this.findFirstFileInTree(n.children);
        if (found) return found;
      }
    }
    return null;
  }
}
