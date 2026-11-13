import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthStore } from './auth.store';

export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  if (!auth.isAuthenticated()) {
    return true;
  }
  const first = auth.memberships()[0];
  if (first) {
    return router.createUrlTree(['/s', first.studioSlug, 'home']);
  }
  return true;
};
