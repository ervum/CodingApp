import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type {
  GeneratePitchesRequest,
  PickPitchRequest,
  PitchDetailDto,
  PitchDto,
  UpdatePitchRequest,
} from '@robdev/shared';
import { Subscription, firstValueFrom } from 'rxjs';
import { PitchesApiService } from '../../core/api/pitches-api.service';
import { SocketService } from '../../core/realtime/socket.service';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { upsertById } from '../../core/state/upsert';
import { ToastService } from '../../shared/ui/toast/toast.service';

@Injectable()
export class PitchesStore {
  private readonly pitchesApi = inject(PitchesApiService);
  private readonly socket = inject(SocketService);
  private readonly studioStore = inject(StudioStoreService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly pitches = signal<PitchDto[]>([]);
  readonly selectedId = signal<string | null>(null);
  readonly detail = signal<PitchDetailDto | null>(null);
  readonly editing = signal<boolean>(false);
  readonly loading = signal<boolean>(false);
  readonly busy = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  private readonly subs = new Subscription();

  constructor() {
    this.wireSocket();
    this.destroyRef.onDestroy(() => this.subs.unsubscribe());
  }

  async load(initialPitchId?: string | null): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    if (!studioId) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const list = await firstValueFrom(this.pitchesApi.list(studioId));
      this.pitches.set(list);
      const targetId =
        initialPitchId ??
        this.selectedId() ??
        list.find((p) => p.status === 'PROPOSED')?.id ??
        list[0]?.id ??
        null;
      if (targetId) {
        await this.select(targetId);
      } else {
        this.selectedId.set(null);
        this.detail.set(null);
      }
    } catch {
      this.error.set('Could not load game pitches.');
    } finally {
      this.loading.set(false);
    }
  }

  async select(id: string | null): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    if (!id || !studioId) {
      this.selectedId.set(null);
      this.detail.set(null);
      return;
    }
    this.selectedId.set(id);
    try {
      const d = await firstValueFrom(this.pitchesApi.getDetail(studioId, id));
      this.detail.set(d);
    } catch {
      this.toast.error('Could not load pitch details.');
    }
  }

  async pick(body: PickPitchRequest = {}): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    const slug = this.studioStore.studio()?.slug ?? 'inclined-games';
    const current = this.detail();
    if (!studioId || !current || this.busy()) return;
    this.busy.set(true);
    try {
      const res = await firstValueFrom(this.pitchesApi.pick(studioId, current.id, body));
      this.studioStore.games.update((g) => upsertById(g, res.game));
      this.studioStore.humanRequests.update((reqs) =>
        reqs.filter((r) => r.kind !== 'PICK_NEXT_GAME'),
      );
      await this.load(res.pitch.id);
      this.toast.success(
        `Picked "${res.game.name}" — Architect is drafting the 12-step blueprint.`,
      );
      void this.router.navigate(['/s', slug, 'games', res.game.slug]);
    } catch {
      this.toast.error('Could not pick this pitch.');
    } finally {
      this.busy.set(false);
    }
  }

  async editAndApprove(patch: UpdatePitchRequest): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    const current = this.detail();
    if (!studioId || !current || this.busy()) return;
    this.busy.set(true);
    try {
      const updated = await firstValueFrom(this.pitchesApi.update(studioId, current.id, patch));
      this.detail.set(updated);
      this.pitches.update((list) => upsertById(list, updated));
      this.editing.set(false);
    } catch {
      this.busy.set(false);
      this.toast.error('Failed to save pitch edits.');
      return;
    }
    this.busy.set(false);
    await this.pick({ gameName: patch.title ?? current.title });
  }

  async requestChanges(feedback: string): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    const current = this.detail();
    if (!studioId || !current || this.busy()) return;
    this.busy.set(true);
    try {
      const res = await firstValueFrom(
        this.pitchesApi.requestChanges(studioId, current.id, { feedback }),
      );
      this.pitches.update((list) => upsertById(list, res.pitch));
      await this.select(current.id);
      this.toast.success('Changes requested from Pulse.');
    } catch {
      this.toast.error('Failed to request changes.');
    } finally {
      this.busy.set(false);
    }
  }

  async generate(opts: GeneratePitchesRequest): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    if (!studioId || this.busy()) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.pitchesApi.generate(studioId, opts));
      this.toast.success('Pulse queued to research market charts and draft new pitches.');
    } catch {
      this.toast.error('Could not queue pitch generation.');
    } finally {
      this.busy.set(false);
    }
  }

  private wireSocket(): void {
    this.subs.add(
      this.socket.on('pitch:updated').subscribe((e) => {
        if (e.studioId !== this.studioStore.studio()?.id) return;
        this.pitches.update((list) => upsertById(list, e.pitch));
        if (this.selectedId() === e.pitch.id) {
          void this.select(e.pitch.id);
        }
      }),
    );
  }
}
