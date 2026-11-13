import { HttpStatus } from '@nestjs/common';
import type { Paginated } from '@robdev/shared';
import { AppError } from '../errors/app-error.js';

export interface CursorPayload {
  createdAt: string;
  id: string;
}

export function encodeCursor(item: { createdAt: Date | string; id: string }): string {
  const createdAt = item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt;
  const payload: CursorPayload = { createdAt, id: item.id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | undefined): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as Partial<CursorPayload>;
    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') {
      throw new Error('Malformed cursor payload');
    }
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      throw new Error('Invalid cursor timestamp');
    }
    return { createdAt, id: parsed.id };
  } catch {
    throw new AppError('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, 'Invalid pagination cursor');
  }
}

export function toPaginated<TRow extends { createdAt: Date | string; id: string }, TDto>(
  rows: TRow[],
  limit: number,
  mapper: (row: TRow) => TDto,
): Paginated<TDto> {
  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const last = slice[slice.length - 1];
  return {
    items: slice.map(mapper),
    nextCursor: hasMore && last ? encodeCursor(last) : null,
  };
}
