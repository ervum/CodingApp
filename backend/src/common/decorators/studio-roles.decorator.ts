import { SetMetadata } from '@nestjs/common';
import type { MembershipRole } from '@robdev/shared';

export const STUDIO_MIN_ROLE_KEY = 'robdev:studioMinRole';
export const StudioRoles = (minRole: MembershipRole) =>
  SetMetadata(STUDIO_MIN_ROLE_KEY, minRole);
