import type { Id, IsoDateString } from './common.dto.js';
import type { MembershipRole } from '../enums.js';

export interface UserDto { id: Id; email: string; displayName: string; avatarColor: string; createdAt: IsoDateString; }
export interface MembershipDto { studioId: Id; studioSlug: string; studioName: string; workspaceLabel: string; role: MembershipRole; }
export interface AuthSessionDto {
  accessToken: string;
  accessTokenExpiresAt: IsoDateString;
  user: UserDto;
  memberships: MembershipDto[];
}
export type MeDto = Omit<AuthSessionDto, 'accessToken' | 'accessTokenExpiresAt'>;
/** JWT payload */
export interface AccessTokenClaims { sub: Id; email: string; name: string; iat: number; exp: number; }
