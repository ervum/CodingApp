import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import type { StudioAssetDto, StudioAssetKind, VaultTreeNodeDto } from '@robdev/shared';
import { Subscription, firstValueFrom } from 'rxjs';
import { AssetsApiService } from '../../core/api/assets-api.service';
import { computeLineDiff, type DiffLine } from '../../core/diff/line-diff';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { EmptyStateComponent } from '../../shared/ui/empty-state/empty-state.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import type { IconName } from '../../shared/ui/icon/icons';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { LibraryStore, type LibraryMode } from './library.store';
import { TelemetryBarComponent } from './telemetry-bar.component';
import { VaultEditorComponent } from './vault-editor.component';
import { VaultPreviewComponent } from './vault-preview.component';
import { VaultTreeComponent } from './vault-tree.component';

export type LibrarySubTab = 'ASSETS' | 'SYSTEMS' | 'VAULT';

export interface LibraryAssetCard {
  id: string;
  name: string;
  category: string;
  usedInLabel: string;
  icon: IconName;
  accent: string;
  robloxAssetId?: string | null;
  mediaUrl?: string | null;
  mimeType?: string | null;
  notes?: string;
}

export interface LibrarySystemCard {
  id: string;
  name: string;
  usedInCount: number;
  usedInLabel: string;
  description: string;
  docId?: string;
}

const LIBRARY_ASSETS: readonly LibraryAssetCard[] = [
  {
    id: 'asset-aura',
    name: 'Aura Rarity Ladder',
    category: 'vfx',
    usedInLabel: 'Used in Game One',
    icon: 'sparkles',
    accent: '#A855F7',
  },
  {
    id: 'asset-arena',
    name: 'Zone 1 Arena Scaffold',
    category: 'environment',
    usedInLabel: 'Used in Game One',
    icon: 'cube',
    accent: '#22C55E',
  },
  {
    id: 'asset-shop',
    name: 'Shop Layout',
    category: 'ui',
    usedInLabel: 'Used in Game One',
    icon: 'grid',
    accent: '#EC4899',
  },
  {
    id: 'asset-sound',
    name: 'Static Boom Sound',
    category: 'sound',
    usedInLabel: 'Used in Game One',
    icon: 'volume',
    accent: '#38BDF8',
  },
];

const LIBRARY_SYSTEMS: readonly LibrarySystemCard[] = [
  {
    id: 'sys-delivery',
    name: 'Delivery loop',
    usedInCount: 1,
    usedInLabel: 'Used in 1 game',
    description:
      'Parcel pickup, timer, drop-off, and streak bonus — ready to drop into any delivery or relay game.',
  },
  {
    id: 'sys-purchase',
    name: 'Server purchase checks',
    usedInCount: 2,
    usedInLabel: 'Used in 2 games',
    description:
      'Receipt verification, duplicate-grant protection, and automatic save recovery on disconnect.',
  },
  {
    id: 'sys-onboarding',
    name: 'First-minute onboarding',
    usedInCount: 2,
    usedInLabel: 'Used in 2 games',
    description:
      'Spawns the player into action within 8 seconds — no text walls, one clear objective arrow.',
  },
  {
    id: 'sys-safezones',
    name: 'Mobile thumbstick safe-zones',
    usedInCount: 2,
    usedInLabel: 'Used in 2 games',
    description:
      'Keeps all HUD buttons clear of the bottom-left movement thumbstick and bottom-right jump area.',
  },
];

@Component({
  selector: 'rd-library-page',
  standalone: true,
  imports: [
    FormsModule,
    EmptyStateComponent,
    IconComponent,
    VaultTreeComponent,
    VaultEditorComponent,
    VaultPreviewComponent,
    TelemetryBarComponent,
  ],
  providers: [LibraryStore],
  templateUrl: './library.page.html',
  styleUrl: './library.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibraryPage implements OnInit {
  readonly studioStore = inject(StudioStoreService);
  readonly libraryStore = inject(LibraryStore);
  private readonly assetsApi = inject(AssetsApiService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly activeTab = signal<LibrarySubTab>('ASSETS');
  readonly liveAssets = signal<StudioAssetDto[]>([]);
  readonly assetKindFilter = signal<StudioAssetKind | 'ALL'>('ALL');
  readonly assetSearchQuery = signal<string>('');

  readonly createAssetModalOpen = signal<boolean>(false);
  readonly newAssetName = signal<string>('');
  readonly newAssetKind = signal<StudioAssetKind>('MESH');
  readonly newAssetRobloxId = signal<string>('');
  readonly newAssetTags = signal<string>('');
  readonly newAssetNotes = signal<string>('');
  readonly creatingAsset = signal<boolean>(false);

  readonly revisionsDrawerOpen = signal<boolean>(false);

  readonly assets = computed<readonly LibraryAssetCard[]>(() => {
    const remote = this.liveAssets();
    const kind = this.assetKindFilter();
    const q = this.assetSearchQuery().trim().toLowerCase();

    const base: LibraryAssetCard[] =
      remote.length > 0
        ? remote.map((a) => ({
            id: a.id,
            name: a.name,
            category: a.kind.toLowerCase(),
            usedInLabel: a.robloxAssetId
              ? `rbxassetid://${a.robloxAssetId}`
              : a.curatedByAgentKey
                ? `Curated by ${a.curatedByAgentKey}`
                : 'Studio Asset',
            icon: this.iconForKind(a.kind),
            accent: this.accentForKind(a.kind),
            robloxAssetId: a.robloxAssetId,
            mediaUrl: a.mediaUrl,
            mimeType: a.mimeType,
            notes: a.notes,
          }))
        : [...LIBRARY_ASSETS];

    return base.filter((card) => {
      if (kind !== 'ALL' && card.category.toUpperCase() !== kind) return false;
      if (
        q &&
        !card.name.toLowerCase().includes(q) &&
        !card.category.toLowerCase().includes(q) &&
        !(card.usedInLabel ?? '').toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  });

  readonly systems = LIBRARY_SYSTEMS;

  readonly vaultDocCount = computed(() => {
    const countDocs = (nodes: VaultTreeNodeDto[]): number =>
      nodes.reduce(
        (acc, n) => acc + (n.type === 'document' ? 1 : countDocs(n.children ?? [])),
        0,
      );
    const total = countDocs(this.libraryStore.tree());
    return total > 0 ? total : 14;
  });

  readonly revisionDiffLines = computed<DiffLine[]>(() => {
    const revMd = this.libraryStore.selectedRevisionMarkdown();
    const currentMd = this.libraryStore.draft();
    if (revMd === null) return [];
    return computeLineDiff(revMd, currentMd);
  });

  readonly conflictDiffLines = computed<DiffLine[]>(() => {
    const conf = this.libraryStore.conflict();
    const currentMd = this.libraryStore.draft();
    if (!conf) return [];
    return computeLineDiff(conf.currentMarkdown, currentMd);
  });

  readonly graphLayout = computed(() => {
    const g = this.libraryStore.graph();
    const nodes = g.nodes;
    const width = 920;
    const height = 560;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(cx, cy) - 70;

    const positioned = nodes.map((n, idx) => {
      const angle = (2 * Math.PI * idx) / Math.max(1, nodes.length) - Math.PI / 2;
      const r = nodes.length <= 1 ? 0 : radius;
      return {
        ...n,
        x: Math.round(cx + r * Math.cos(angle)),
        y: Math.round(cy + r * Math.sin(angle)),
      };
    });

    const posById = new Map(positioned.map((p) => [p.id, p]));
    const edges = g.edges
      .map((e, idx) => {
        const from = posById.get(e.from);
        const to = e.to ? posById.get(e.to) : null;
        if (!from) return null;
        const targetX = to ? to.x : Math.min(width - 40, from.x + 70);
        const targetY = to ? to.y : Math.max(40, from.y - 45);
        return {
          id: `edge-${idx}-${e.from}-${e.targetPath}`,
          x1: from.x,
          y1: from.y,
          x2: targetX,
          y2: targetY,
          broken: e.broken,
          targetPath: e.targetPath,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    return { nodes: positioned, edges, width, height };
  });

  private readonly subs = new Subscription();

  constructor() {
    effect(() => {
      const studioId = this.studioStore.studioId();
      if (studioId) {
        void this.loadAssets(studioId);
      }
    });
  }

  ngOnInit(): void {
    this.subs.add(
      this.route.queryParamMap.subscribe((params) => {
        const docParam = params.get('doc');
        const qParam = params.get('q');
        const modeParam = params.get('mode') as LibraryMode | null;
        if (docParam || qParam) {
          this.activeTab.set('VAULT');
        }
        if (modeParam && (modeParam === 'view' || modeParam === 'split' || modeParam === 'edit')) {
          this.libraryStore.mode.set(modeParam);
        }
        if (this.libraryStore.tree().length === 0) {
          void this.libraryStore.load(docParam ?? qParam);
        } else if (docParam && docParam !== this.libraryStore.docId()) {
          void this.libraryStore.open(docParam);
        }
      }),
    );
    this.destroyRef.onDestroy(() => this.subs.unsubscribe());
  }

  async loadAssets(studioId: string): Promise<void> {
    try {
      const items = await firstValueFrom(this.assetsApi.list(studioId));
      this.liveAssets.set(items);
    } catch {
      // ignore
    }
  }

  async copyRobloxAssetId(robloxAssetId: string, event: Event): Promise<void> {
    event.stopPropagation();
    const uri = robloxAssetId.startsWith('rbxassetid://')
      ? robloxAssetId
      : `rbxassetid://${robloxAssetId}`;
    try {
      await navigator.clipboard?.writeText(uri);
    } catch {
      // ignore
    }
    this.toast.success(`Copied ${uri}`);
  }

  async submitCreateAsset(): Promise<void> {
    const studioId = this.studioStore.studioId();
    const name = this.newAssetName().trim();
    if (!studioId || !name || this.creatingAsset()) return;
    this.creatingAsset.set(true);
    try {
      const rawId = this.newAssetRobloxId().replace(/^rbxassetid:\/\//i, '').trim();
      const tags = this.newAssetTags()
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const created = await firstValueFrom(
        this.assetsApi.create(studioId, {
          kind: this.newAssetKind(),
          name,
          robloxAssetId: rawId || null,
          mediaId: null,
          tags,
          notes: this.newAssetNotes().trim(),
        }),
      );
      this.liveAssets.update((list) => [created, ...list]);
      this.createAssetModalOpen.set(false);
      this.newAssetName.set('');
      this.newAssetRobloxId.set('');
      this.newAssetTags.set('');
      this.newAssetNotes.set('');
      this.toast.success(`Registered asset "${created.name}"`);
    } catch {
      this.toast.error('Failed to register studio asset');
    } finally {
      this.creatingAsset.set(false);
    }
  }

  onOpenDoc(idOrTarget: string): void {
    this.libraryStore.vaultViewMode.set('editor');
    void this.libraryStore.open(idOrTarget).then(() => {
      const id = this.libraryStore.docId();
      if (id) {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { doc: id },
          queryParamsHandling: 'merge',
        });
      }
    });
  }

  onModeChange(mode: LibraryMode): void {
    this.libraryStore.mode.set(mode);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { mode },
      queryParamsHandling: 'merge',
    });
  }

  private iconForKind(kind: StudioAssetKind): IconName {
    switch (kind) {
      case 'AUDIO':
        return 'volume';
      case 'MESH':
        return 'cube';
      case 'DECAL':
      case 'IMAGE':
        return 'grid';
      default:
        return 'sparkles';
    }
  }

  private accentForKind(kind: StudioAssetKind): string {
    switch (kind) {
      case 'AUDIO':
        return '#38BDF8';
      case 'MESH':
        return '#22C55E';
      case 'IMAGE':
      case 'DECAL':
        return '#EC4899';
      default:
        return '#A855F7';
    }
  }
}
