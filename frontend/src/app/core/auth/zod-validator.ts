import type { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import type { z } from 'zod';

/**
 * Validates a Reactive FormGroup against a Zod object schema and sets `{ zod: message }`
 * on child controls with issues.
 */
export function zodGroupValidator<T extends z.ZodType>(schema: T): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const result = schema.safeParse(group.getRawValue());
    const controlsRecord = (group as { controls?: Record<string, AbstractControl> }).controls;

    if (controlsRecord) {
      for (const ctrl of Object.values(controlsRecord)) {
        const existing = ctrl.errors;
        if (existing && 'zod' in existing) {
          const rest = { ...existing };
          delete rest['zod'];
          ctrl.setErrors(Object.keys(rest).length > 0 ? rest : null, { emitEvent: false });
        }
      }
    }

    if (result.success) {
      return null;
    }

    const groupErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const field = issue.path[0] !== undefined ? String(issue.path[0]) : '_form';
      if (!(field in groupErrors)) {
        groupErrors[field] = issue.message;
      }
      const ctrl = controlsRecord?.[field];
      if (ctrl && (ctrl.dirty || ctrl.touched)) {
        ctrl.setErrors({ ...(ctrl.errors ?? {}), zod: issue.message }, { emitEvent: false });
      }
    }

    return { zod: groupErrors };
  };
}
