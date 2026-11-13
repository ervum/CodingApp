import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { MemberDto, MembershipRole } from '@robdev/shared';
import { firstValueFrom } from 'rxjs';
import { StudioApiService } from '../../core/api/studio-api.service';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { RelativeTimePipe } from '../../shared/pipes/relative-time.pipe';
import { ToastService } from '../../shared/ui/toast/toast.service';

@Component({
  selector: 'rd-members',
  standalone: true,
  imports: [FormsModule, RelativeTimePipe],
  templateUrl: './members.component.html',
  styleUrl: './members.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MembersComponent {
  readonly store = inject(StudioStoreService);
  private readonly studioApi = inject(StudioApiService);
  private readonly toast = inject(ToastService);

  readonly members = signal<MemberDto[]>([]);
  readonly email = signal('');
  readonly role = signal<'ADMIN' | 'PRODUCER' | 'VIEWER'>('PRODUCER');
  readonly adding = signal(false);

  constructor() {
    effect(() => {
      const studioId = this.store.studioId();
      if (studioId) {
        void this.load();
      }
    });
  }

  async load(): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId) return;
    const list = await firstValueFrom(this.studioApi.listMembers(studioId));
    this.members.set(list);
  }

  async addMember(): Promise<void> {
    const studioId = this.store.studio()?.id;
    const emailVal = this.email().trim();
    if (!studioId || !emailVal || this.adding()) return;
    this.adding.set(true);
    try {
      await firstValueFrom(
        this.studioApi.addMember(studioId, { email: emailVal, role: this.role() }),
      );
      this.email.set('');
      await this.load();
      this.toast.success(`Added ${emailVal}`);
    } catch {
      this.toast.error('Could not add member (user must be registered)');
    } finally {
      this.adding.set(false);
    }
  }

  async changeRole(member: MemberDto, newRole: MembershipRole): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId) return;
    await firstValueFrom(
      this.studioApi.updateMember(studioId, member.userId, { role: newRole }),
    );
    await this.load();
    this.toast.success(`Updated ${member.displayName} role to ${newRole}`);
  }

  async removeMember(member: MemberDto): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId) return;
    await firstValueFrom(this.studioApi.removeMember(studioId, member.userId));
    await this.load();
    this.toast.warning(`Removed ${member.displayName}`);
  }
}
