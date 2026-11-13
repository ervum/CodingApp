import { Injectable, signal } from '@angular/core';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface ToastItem {
  id: string;
  tone: ToastTone;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 1;
  readonly toasts = signal<ToastItem[]>([]);

  show(tone: ToastTone, message: string, durationMs = 4200): string {
    const id = `toast-${this.nextId++}`;
    this.toasts.update((list) => [...list, { id, tone, message }]);
    if (durationMs > 0) {
      setTimeout(() => {
        this.dismiss(id);
      }, durationMs);
    }
    return id;
  }

  info(message: string, durationMs?: number): string {
    return this.show('info', message, durationMs);
  }

  success(message: string, durationMs?: number): string {
    return this.show('success', message, durationMs);
  }

  warning(message: string, durationMs?: number): string {
    return this.show('warning', message, durationMs);
  }

  error(message: string, durationMs?: number): string {
    return this.show('error', message, durationMs);
  }

  dismiss(id: string): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }
}
