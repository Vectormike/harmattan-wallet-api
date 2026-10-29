import { HttpStatus } from '@nestjs/common';
import { ApiError } from './api-error';

const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export function requireIdempotencyKey(value?: string): string {
  if (!value) {
    throw new ApiError(
      HttpStatus.BAD_REQUEST,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Idempotency-Key header is required',
    );
  }
  if (!KEY_PATTERN.test(value)) {
    throw new ApiError(
      HttpStatus.BAD_REQUEST,
      'INVALID_IDEMPOTENCY_KEY',
      'Idempotency-Key must be 8-128 characters using letters, numbers, dot, underscore, colon, or hyphen',
    );
  }
  return value;
}
