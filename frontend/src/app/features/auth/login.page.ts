import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LoginRequestSchema } from '@robdev/shared';
import { AuthStore } from '../../core/auth/auth.store';
import { zodGroupValidator } from '../../core/auth/zod-validator';
import { SpinnerComponent } from '../../shared/ui/spinner/spinner.component';

@Component({
  selector: 'rd-login-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, SpinnerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.page.html',
  styleUrl: './login.page.scss',
})
export class LoginPage {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  readonly returnUrl = input<string | undefined>();
  readonly submitting = signal(false);
  readonly serverError = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group(
    {
      email: [''],
      password: [''],
    },
    { validators: zodGroupValidator(LoginRequestSchema) },
  );

  fieldError(name: 'email' | 'password'): string | null {
    const ctrl = this.form.controls[name];
    if (!ctrl.touched && !ctrl.dirty) return null;
    const err = ctrl.errors?.['zod'];
    return typeof err === 'string' ? err : null;
  }

  async submit(): Promise<void> {
    const raw = this.form.getRawValue();
    this.form.patchValue({ email: raw.email.trim() });
    this.form.markAllAsTouched();
    this.form.updateValueAndValidity();
    if (this.form.invalid || this.submitting()) return;

    this.submitting.set(true);
    this.serverError.set(null);
    try {
      await this.auth.login({
        email: raw.email.trim(),
        password: raw.password,
      });
      const target = this.returnUrl() || '/';
      await this.router.navigateByUrl(target);
    } catch (err: unknown) {
      if (err instanceof HttpErrorResponse && (err.status === 502 || err.status === 504 || err.status === 0)) {
        this.serverError.set('Backend server is unreachable (502 Bad Gateway). Ensure the backend is running on port 3000.');
      } else if (err instanceof HttpErrorResponse && err.status === 429) {
        this.serverError.set('Too many login attempts. Please wait a moment and try again.');
      } else {
        this.serverError.set('Invalid email or password.');
      }
    } finally {
      this.submitting.set(false);
    }
  }
}
