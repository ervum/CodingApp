import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import type {
  VaultDocumentDto,
  VaultGraphDto,
  VaultRevisionDto,
  VaultTreeNodeDto,
} from '@robdev/shared';
import { Subscription, firstValueFrom } from 'rxjs';
import { VaultApiService } from '../../core/api/vault-api.service';
import { SocketService } from '../../core/realtime/socket.service';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { ToastService } from '../../shared/ui/toast/toast.service';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error';
export type LibraryMode = 'view' | 'split' | 'edit';

@Injectable()
export class LibraryStore {
  private readonly vaultApi = inject(VaultApiService);
  private readonly socket = inject(SocketService);
  private readonly studioStore = inject(StudioStoreService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly tree = signal<VaultTreeNodeDto[]>([]);
  readonly graph = signal<VaultGraphDto>({ nodes: [], edges: [] });
  readonly vaultViewMode = signal<'editor' | 'graph'>('editor');
  readonly docId = signal<string | null>(null);
  readonly doc = signal<VaultDocumentDto | null>(null);
  readonly draft = signal<string>('');
  readonly titleDraft = signal<string>('');
  readonly mode = signal<LibraryMode>('split');
  readonly saveState = signal<SaveState>('saved');
  readonly conflict = signal<{ currentVersion: number; currentMarkdown: string } | null>(null);
  readonly revisions = signal<VaultRevisionDto[]>([]);
  readonly selectedRevisionVersion = signal<number | null>(null);
  readonly selectedRevisionMarkdown = signal<string | null>(null);
  readonly loading = signal<boolean>(false);

  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly subs = new Subscription();
  private readonly docLookup = new Map<string, string>();

  constructor() {
    this.wireSocket();
    this.destroyRef.onDestroy(() => {
      this.clearAutosave();
      this.subs.unsubscribe();
    });
  }

  readonly resolveWikilink = (target: string): string | null => {
    const clean = target.trim().replace(/\.md$/i, '').toLowerCase();
    return this.docLookup.get(clean) ?? null;
  };

  async load(initialDocParam?: string | null): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    if (!studioId) return;
    this.loading.set(true);
    try {
      const tree = await firstValueFrom(this.vaultApi.tree(studioId));
      this.tree.set(tree);
      this.rebuildLookup(tree);

      void this.loadGraph();

      const targetId = this.resolveInitialDocId(tree, initialDocParam);
      if (targetId) {
        await this.open(targetId);
      }
    } finally {
      this.loading.set(false);
    }
  }

  async loadGraph(): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    if (!studioId) return;
    try {
      const g = await firstValueFrom(this.vaultApi.getGraph(studioId));
      this.graph.set(g);
    } catch {
      // ignore
    }
  }

  async open(idOrTarget: string): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    if (!studioId) return;
    this.clearAutosave();

    const resolvedId = this.resolveWikilink(idOrTarget) ?? idOrTarget;
    try {
      const doc = await firstValueFrom(this.vaultApi.getDocument(studioId, resolvedId));
      this.docId.set(doc.id);
      this.doc.set(doc);
      this.draft.set(doc.markdown);
      this.titleDraft.set(doc.title);
      this.saveState.set('saved');
      this.conflict.set(null);
      this.selectedRevisionVersion.set(null);
      this.selectedRevisionMarkdown.set(null);

      void firstValueFrom(this.vaultApi.listRevisions(studioId, doc.id))
        .then((revs) => this.revisions.set(revs))
        .catch(() => undefined);
    } catch {
      this.toast.error('Could not open vault document.');
    }
  }

  async inspectRevision(version: number): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    const current = this.doc();
    if (!studioId || !current) return;
    this.selectedRevisionVersion.set(version);
    try {
      const rev = await firstValueFrom(this.vaultApi.getRevision(studioId, current.id, version));
      this.selectedRevisionMarkdown.set(rev.markdown);
    } catch {
      this.toast.error(`Could not load revision v${version}.`);
    }
  }

  async restoreRevision(version: number): Promise<void> {
    const md = this.selectedRevisionMarkdown();
    const current = this.doc();
    if (md === null || !current) return;
    this.draft.set(md);
    this.saveState.set('dirty');
    await this.save(current.version);
    this.selectedRevisionVersion.set(null);
    this.selectedRevisionMarkdown.set(null);
    this.toast.success(`Restored v${version}`);
  }

  edit(text: string): void {
    this.draft.set(text);
    const current = this.doc();
    if (!current) return;
    if (text === current.markdown && this.titleDraft().trim() === current.title) {
      this.saveState.set('saved');
      this.clearAutosave();
      return;
    }
    this.saveState.set('dirty');
    this.scheduleAutosave();
  }

  editTitle(title: string): void {
    this.titleDraft.set(title);
    const current = this.doc();
    if (!current) return;
    if (this.draft() === current.markdown && title.trim() === current.title) {
      this.saveState.set('saved');
      this.clearAutosave();
      return;
    }
    this.saveState.set('dirty');
    this.scheduleAutosave();
  }

  async save(overrideBaseVersion?: number): Promise<void> {
    this.clearAutosave();
    const studioId = this.studioStore.studio()?.id;
    const current = this.doc();
    if (!studioId || !current) return;
    if (this.saveState() !== 'dirty' && overrideBaseVersion === undefined) return;

    this.saveState.set('saving');
    try {
      const saved = await firstValueFrom(
        this.vaultApi.saveDocument(studioId, current.id, {
          markdown: this.draft(),
          title: this.titleDraft().trim() || current.title,
          baseVersion: overrideBaseVersion ?? current.version,
        }),
      );
      this.doc.set(saved);
      this.draft.set(saved.markdown);
      this.titleDraft.set(saved.title);
      this.saveState.set('saved');
      this.conflict.set(null);
      await this.refreshTreeSilently();
      void this.loadGraph();
      void firstValueFrom(this.vaultApi.listRevisions(studioId, saved.id))
        .then((revs) => this.revisions.set(revs))
        .catch(() => undefined);
    } catch (err: unknown) {
      if (err instanceof HttpErrorResponse && err.status === 409) {
        const body = err.error as
          | { details?: { currentVersion?: number; currentMarkdown?: string } }
          | undefined;
        if (
          body?.details &&
          typeof body.details.currentVersion === 'number' &&
          typeof body.details.currentMarkdown === 'string'
        ) {
          this.conflict.set({
            currentVersion: body.details.currentVersion,
            currentMarkdown: body.details.currentMarkdown,
          });
        } else {
          const latest = await firstValueFrom(this.vaultApi.getDocument(studioId, current.id));
          this.conflict.set({
            currentVersion: latest.version,
            currentMarkdown: latest.markdown,
          });
        }
        this.saveState.set('conflict');
      } else {
        this.saveState.set('error');
        this.toast.error('Failed to save vault document.');
      }
    }
  }

  async resolveConflict(choice: 'mine' | 'theirs'): Promise<void> {
    const current = this.doc();
    const conf = this.conflict();
    if (!current || !conf) return;
    if (choice === 'mine') {
      await this.save(conf.currentVersion);
    } else {
      await this.open(current.id);
    }
  }

  async createDoc(folderId: string, title: string): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    if (!studioId) return;
    try {
      const created = await firstValueFrom(
        this.vaultApi.createDocument(studioId, {
          folderId,
          title: title.trim(),
          markdown: `# ${title.trim()}\n\n`,
        }),
      );
      await this.refreshTreeSilently();
      void this.loadGraph();
      await this.open(created.id);
      this.toast.success(`Created "${created.title}"`);
    } catch {
      this.toast.error('Could not create document.');
    }
  }

  async createFolder(parentId: string | null, name: string): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    if (!studioId) return;
    try {
      await firstValueFrom(
        this.vaultApi.createFolder(studioId, {
          parentId,
          name: name.trim(),
        }),
      );
      await this.refreshTreeSilently();
      this.toast.success(`Created folder "${name.trim()}"`);
    } catch {
      this.toast.error('Could not create folder.');
    }
  }

  private scheduleAutosave(): void {
    this.clearAutosave();
    this.autosaveTimer = setTimeout(() => {
      void this.save();
    }, 2000);
  }

  private clearAutosave(): void {
    if (this.autosaveTimer !== null) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
  }

  private async refreshTreeSilently(): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    if (!studioId) return;
    try {
      const tree = await firstValueFrom(this.vaultApi.tree(studioId));
      this.tree.set(tree);
      this.rebuildLookup(tree);
    } catch {
      // ignore transient error
    }
  }

  private rebuildLookup(nodes: VaultTreeNodeDto[]): void {
    this.docLookup.clear();
    const walk = (items: VaultTreeNodeDto[]): void => {
      for (const n of items) {
        if (n.type === 'document') {
          this.docLookup.set(n.id.toLowerCase(), n.id);
          this.docLookup.set(n.name.replace(/\.md$/i, '').toLowerCase(), n.id);
          this.docLookup.set(n.path.replace(/\.md$/i, '').toLowerCase(), n.id);
        }
        if (n.children) walk(n.children);
      }
    };
    walk(nodes);
  }

  private resolveInitialDocId(
    nodes: VaultTreeNodeDto[],
    param?: string | null,
  ): string | null {
    if (param) {
      const byLookup = this.resolveWikilink(param);
      if (byLookup) return byLookup;
      return param;
    }
    if (this.docId()) return this.docId();
    const uiHud = this.resolveWikilink('05 UI and HUD');
    if (uiHud) return uiHud;

    const findFirstDoc = (items: VaultTreeNodeDto[]): string | null => {
      for (const n of items) {
        if (n.type === 'document') return n.id;
        if (n.children) {
          const nested = findFirstDoc(n.children);
          if (nested) return nested;
        }
      }
      return null;
    };
    return findFirstDoc(nodes);
  }

  private wireSocket(): void {
    this.subs.add(
      this.socket.on('vault:document-updated').subscribe((e) => {
        if (e.studioId !== this.studioStore.studio()?.id) return;
        void this.refreshTreeSilently();
        void this.loadGraph();
        if (e.documentId === this.docId()) {
          const cur = this.doc();
          if (cur && e.version <= cur.version) return;
          if (this.saveState() === 'saved') {
            void this.open(e.documentId);
          } else if (this.saveState() === 'dirty') {
            const studioId = this.studioStore.studio()?.id;
            if (!studioId) return;
            void firstValueFrom(this.vaultApi.getDocument(studioId, e.documentId))
              .then((latest) => {
                this.conflict.set({
                  currentVersion: latest.version,
                  currentMarkdown: latest.markdown,
                });
                this.saveState.set('conflict');
              })
              .catch(() => undefined);
          }
        }
      }),
    );
  }
}
