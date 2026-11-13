export type Id = string;
export type IsoDateString = string;

export interface Paginated<T> { items: T[]; nextCursor: string | null; }

export type ErrorCode =
  | 'VALIDATION_FAILED' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT'
  | 'VERSION_CONFLICT' | 'RATE_LIMITED' | 'REGISTRATION_DISABLED' | 'INVALID_CREDENTIALS'
  | 'NO_MODEL_BINDING' | 'PROVIDER_AUTH_FAILED' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_BAD_REQUEST'
  | 'PROVIDER_RATE_LIMITED'
  | 'NO_IMAGE_MODEL' | 'STUDIO_PAUSED' | 'LANE_BUSY' | 'FIX_FIRST_BLOCKERS_OPEN'
  | 'INGESTION_IN_PROGRESS' | 'SCHEMA_DRIFT' | 'RUN_TIMEOUT' | 'TOOL_LOOP_LIMIT' | 'INTERNAL';

export interface ApiErrorBody {
  statusCode: number;
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown> | Array<{ path: string; message: string }>;
}
