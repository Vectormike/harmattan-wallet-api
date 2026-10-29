import { HttpStatus } from '@nestjs/common';
import { ApiError } from './api-error';

export interface TransactionCursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(cursor: TransactionCursor): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
    }),
  ).toString('base64url');
}

export function decodeCursor(cursor?: string): TransactionCursor | undefined {
  if (!cursor) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as { createdAt?: string; id?: string };
    const createdAt = new Date(parsed.createdAt ?? '');
    if (!parsed.id || Number.isNaN(createdAt.getTime())) {
      throw new Error('invalid cursor');
    }
    return { id: parsed.id, createdAt };
  } catch {
    throw new ApiError(
      HttpStatus.BAD_REQUEST,
      'INVALID_CURSOR',
      'Cursor is invalid',
    );
  }
}
