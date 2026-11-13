import {
  ChangeDetectionStrategy,
  Component,
  type OnChanges,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  PITCH_SECTION_TITLES,
  PitchSectionKeyTuple,
  type PitchDetailDto,
  type PitchSectionKey,
  type UpdatePitchRequest,
} from '@robdev/shared';
import { DialogComponent } from '../../shared/ui/dialog/dialog.component';

@Component({
  selector: 'rd-pitch-edit-dialog',
  standalone: true,
  imports: [FormsModule, DialogComponent],
  templateUrl: './pitch-edit-dialog.component.html',
  styleUrl: './pitch-edit-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PitchEditDialogComponent implements OnChanges {
  readonly pitch = input.required<PitchDetailDto>();
  readonly open = model(false);
  readonly save = output<UpdatePitchRequest>();

  readonly sectionKeys: readonly PitchSectionKey[] = PitchSectionKeyTuple;
  readonly sectionTitles = PITCH_SECTION_TITLES;

  readonly title = signal('');
  readonly logline = signal('');
  readonly whatChanged = signal('');
  readonly howDifferent = signal('');
  readonly sectionMap = signal<Record<PitchSectionKey, string>>({
    FIRST_60_SECONDS: '',
    FIVE_MINUTE_LOOP: '',
    MINUTES_10_30: '',
    MONETIZATION: '',
    COMPETITORS: '',
    RISKS: '',
  });

  ngOnChanges(): void {
    const p = this.pitch();
    this.title.set(p.title);
    this.logline.set(p.logline);
    this.whatChanged.set(p.whatChanged);
    this.howDifferent.set(p.howDifferent);
    const nextMap: Record<PitchSectionKey, string> = {
      FIRST_60_SECONDS: '',
      FIVE_MINUTE_LOOP: '',
      MINUTES_10_30: '',
      MONETIZATION: '',
      COMPETITORS: '',
      RISKS: '',
    };
    for (const sec of p.sections) {
      nextMap[sec.key] = sec.markdown;
    }
    this.sectionMap.set(nextMap);
  }

  updateSection(key: PitchSectionKey, value: string): void {
    this.sectionMap.update((m) => ({ ...m, [key]: value }));
  }

  submit(): void {
    const map = this.sectionMap();
    const sections = this.sectionKeys
      .map((key) => ({ key, markdown: map[key].trim() }))
      .filter((s) => s.markdown.length > 0);

    this.save.emit({
      title: this.title().trim(),
      logline: this.logline().trim(),
      whatChanged: this.whatChanged().trim(),
      howDifferent: this.howDifferent().trim(),
      sections,
    });
  }
}
