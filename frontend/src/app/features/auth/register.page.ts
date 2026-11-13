import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { RegisterRequestSchema } from '@robdev/shared';
import { AuthStore } from '../../core/auth/auth.store';
import { zodGroupValidator } from '../../core/auth/zod-validator';
import { SpinnerComponent } from '../../shared/ui/spinner/spinner.component';

@Component({
  selector: 'rd-register-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, SpinnerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './register.page.html',
  styleUrl: './register.page.scss',
})
export class RegisterPage {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  readonly submitting = signal(false);
  readonly serverError = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group(
    {
      displayName: [''],
      email: [''],
      password: [''],
      studioName: [''],
    },
    { validators: zodGroupValidator(RegisterRequestSchema) },
  );

  fieldError(name: 'displayName' | 'email' | 'password' | 'studioName'): string | null {
    const ctrl = this.form.controls[name];
    if (!ctrl.touched && !ctrl.dirty) return null;
    const err = ctrl.errors?.['zod'];
    return typeof err === 'string' ? err : null;
  }

  async submit(): Promise<void> {
    this.form.markAllAsTouched();
    this.form.updateValueAndValidity();
    if (this.form.invalid || this.submitting()) return;

    this.submitting.set(true);
    this.serverError.set(null);
    try {
      const raw = this.form.getRawValue();
      await this.auth.register({
        displayName: raw.displayName.trim(),
        email: raw.email.trim(),
        password: raw.password,
        ...(raw.studioName.trim().length > 0 ? { studioName: raw.studioName.trim() } : {}),
      });
      await this.router.navigateByUrl('/');
    } catch {
      this.serverError.set('Could not register account. Email may already be in use.');
    } finally {
      this.submitting.set(false);
    }
  }
}
