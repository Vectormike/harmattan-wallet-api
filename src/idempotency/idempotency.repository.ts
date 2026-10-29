import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { IdempotencyRecord, Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable()
export class IdempotencyRepository {
  constructor(private readonly prisma: PrismaService) {}

  find(scope: string, key: string): Promise<IdempotencyRecord | null> {
    return this.prisma.idempotencyRecord.findUnique({
      where: { scope_key: { scope, key } },
    });
  }

  async claim(
    tx: TransactionClient,
    scope: string,
    key: string,
    requestHash: string,
  ): Promise<{ insertedId?: string; existing?: IdempotencyRecord }> {
    const id = randomUUID();
    const inserted = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      INSERT INTO "idempotency_records"
        ("id", "scope", "key", "request_hash", "response_status", "response_body", "created_at", "completed_at")
      VALUES
        (${id}::uuid, ${scope}, ${key}, ${requestHash}, 0, '{}'::jsonb, NOW(), NOW())
      ON CONFLICT ("scope", "key") DO NOTHING
      RETURNING "id"
    `);

    if (inserted.length === 1) {
      return { insertedId: id };
    }

    const existing = await tx.idempotencyRecord.findUniqueOrThrow({
      where: { scope_key: { scope, key } },
    });
    return { existing };
  }

  finalize(
    tx: TransactionClient,
    id: string,
    status: number,
    body: Prisma.InputJsonValue,
    transactionId?: string,
  ): Promise<IdempotencyRecord> {
    return tx.idempotencyRecord.update({
      where: { id },
      data: {
        responseStatus: status,
        responseBody: body,
        transactionId,
        completedAt: new Date(),
      },
    });
  }
}
