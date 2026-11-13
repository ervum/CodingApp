import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthStore } from '../auth/auth.store';
import { StudioStoreService } from './studio-store.service';

export const studioContextGuard: CanActivateFn = async (route) => {
  const auth = inject(AuthStore);
  const store = inject(StudioStoreService);
  const router = inject(Router);

  const studioSlug = route.paramMap.get('studioSlug');
  const membership = auth.memberships().find((m) => m.studioSlug === studioSlug);
  if (!membership) {
    return router.createUrlTree(['/']);
  }

  try {
    await store.activate(membership.studioId);
  } catch {
    // StudioShell renders a full-page error state with Retry when loadState === 'error'
  }
  return true;
};
