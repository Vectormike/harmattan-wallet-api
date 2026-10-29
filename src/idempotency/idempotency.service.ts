import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiError } from '../common/api-error';
import { requestHash } from '../common/canonical-request';
import { PrismaService } from '../database/prisma.service';
import {
  IdempotencyRepository,
  TransactionClient,
} from './idempotency.repository';

export interface IdempotentWorkResult<T extends Record<string, unknown>> {
  status: number;
  body: T;
  transactionId?: string;
}

export interface IdempotentResult<
  T extends Record<string, unknown>,
> extends IdempotentWorkResult<T> {
  replayed: boolean;
}

@Injectable()
export class IdempotencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: IdempotencyRepository,
  ) {}

  async replayIfExists<T extends Record<string, unknown>>(
    scope: string,
    key: string,
    request: unknown,
  ): Promise<IdempotentResult<T> | null> {
    const hash = requestHash(request);
    const existing = await this.records.find(scope, key);
    return existing
      ? this.replay<T>(existing.requestHash, hash, existing)
      : null;
  }

  async execute<T extends Record<string, unknown>>(
    scope: string,
    key: string,
    request: unknown,
    work: (tx: TransactionClient) => Promise<IdempotentWorkResult<T>>,
  ): Promise<IdempotentResult<T>> {
    const hash = requestHash(request);
    const replay = await this.replayIfExists<T>(scope, key, request);
    if (replay) {
      return replay;
    }

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const claim = await this.records.claim(tx, scope, key, hash);
            if (claim.existing) {
              return this.replay<T>(
                claim.existing.requestHash,
                hash,
                claim.existing,
              );
            }

            const result = await work(tx);
            await this.records.finalize(
              tx,
              claim.insertedId!,
              result.status,
              result.body as Prisma.InputJsonObject,
              result.transactionId,
            );
            return { ...result, replayed: false };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
            maxWait: 5000,
            timeout: 10_000,
          },
        );
      } catch (error) {
        if (this.retryable(error) && attempt < 3) {
          continue;
        }
        throw error;
      }
    }

    throw new ApiError(
      HttpStatus.CONFLICT,
      'TRANSACTION_RETRY_EXHAUSTED',
      'The operation could not be completed after several retries',
    );
  }

  private replay<T extends Record<string, unknown>>(
    existingHash: string,
    incomingHash: string,
    existing: {
      responseStatus: number;
      responseBody: Prisma.JsonValue;
      transactionId: string | null;
    },
  ): IdempotentResult<T> {
    if (existingHash !== incomingHash) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'IDEMPOTENCY_KEY_REUSED',
        'That Idempotency-Key was already used with a different request',
      );
    }
    if (existing.responseStatus === 0) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'IDEMPOTENCY_REQUEST_IN_PROGRESS',
        'An operation with that Idempotency-Key is still in progress',
      );
    }
    return {
      status: existing.responseStatus,
      body: existing.responseBody as T,
      transactionId: existing.transactionId ?? undefined,
      replayed: true,
    };
  }

  private retryable(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2034'
    );
  }
}
