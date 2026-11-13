import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ClockService {
  readonly now = signal<Date>(new Date());

  constructor() {
    setInterval(() => {
      this.now.set(new Date());
    }, 60_000);
  }
}
