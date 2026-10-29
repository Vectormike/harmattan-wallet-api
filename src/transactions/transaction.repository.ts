import { HttpStatus, Injectable } from '@nestjs/common';
import {
  Currency,
  Prisma,
  SwapQuote,
  Transaction,
  TransactionType,
} from '@prisma/client';
import { ApiError } from '../common/api-error';
import { TransactionCursor } from '../common/cursor';
import { PrismaService } from '../database/prisma.service';
import { TransactionClient } from '../idempotency/idempotency.repository';

export interface BalanceRef {
  walletId: string;
  currency: Currency;
}

export interface LockedBalance extends BalanceRef {
  available: Prisma.Decimal;
}

export interface HistoryFilter {
  walletId: string;
  type?: TransactionType;
  currency?: Currency;
  cursor?: TransactionCursor;
  limit: number;
}

@Injectable()
export class TransactionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async lockBalances(
    tx: TransactionClient,
    requested: BalanceRef[],
  ): Promise<Map<string, LockedBalance>> {
    const refs = Array.from(
      new Map(
        requested.map((ref) => [`${ref.walletId}:${ref.currency}`, ref]),
      ).values(),
    ).sort((left, right) =>
      `${left.walletId}:${left.currency}`.localeCompare(
        `${right.walletId}:${right.currency}`,
      ),
    );

    const tuples = Prisma.join(
      refs.map(
        (ref) =>
          Prisma.sql`(${ref.walletId}::uuid, ${ref.currency}::"Currency")`,
      ),
    );
    const rows = await tx.$queryRaw<
      Array<{
        walletId: string;
        currency: Currency;
        available: Prisma.Decimal;
      }>
    >(Prisma.sql`
      SELECT
        "wallet_id" AS "walletId",
        "currency",
        "available"
      FROM "wallet_balances"
      WHERE ("wallet_id", "currency") IN (${tuples})
      ORDER BY "wallet_id", "currency"
      FOR UPDATE
    `);

    if (rows.length !== refs.length) {
      throw new ApiError(
        HttpStatus.NOT_FOUND,
        'BALANCE_NOT_FOUND',
        'One or more requested wallet balances do not exist',
      );
    }

    return new Map(
      rows.map((row) => [
        `${row.walletId}:${row.currency}`,
        {
          walletId: row.walletId,
          currency: row.currency,
          available: new Prisma.Decimal(row.available),
        },
      ]),
    );
  }

  setBalance(
    tx: TransactionClient,
    walletId: string,
    currency: Currency,
    available: Prisma.Decimal,
  ) {
    return tx.walletBalance.update({
      where: { walletId_currency: { walletId, currency } },
      data: { available },
    });
  }

  createTransaction(
    tx: TransactionClient,
    data: Prisma.TransactionUncheckedCreateInput,
  ): Promise<Transaction> {
    return tx.transaction.create({ data });
  }

  createQuote(data: Prisma.SwapQuoteUncheckedCreateInput): Promise<SwapQuote> {
    return this.prisma.swapQuote.create({ data });
  }

  findQuote(id: string): Promise<SwapQuote | null> {
    return this.prisma.swapQuote.findUnique({ where: { id } });
  }

  findQuoteInTransaction(
    tx: TransactionClient,
    id: string,
  ): Promise<SwapQuote | null> {
    return tx.swapQuote.findUnique({ where: { id } });
  }

  recentMatchingDeposits(
    walletId: string,
    amount: Prisma.Decimal,
    since: Date,
  ): Promise<Array<{ id: string }>> {
    return this.prisma.transaction.findMany({
      where: {
        type: TransactionType.DEPOSIT,
        destinationWalletId: walletId,
        sourceAmount: amount,
        createdAt: { gte: since },
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async recentTransferRecipients(
    senderWalletId: string,
    since: Date,
  ): Promise<Set<string>> {
    const rows = await this.prisma.transaction.findMany({
      where: {
        type: TransactionType.TRANSFER,
        sourceWalletId: senderWalletId,
        destinationWalletId: { not: null },
        createdAt: { gte: since },
      },
      distinct: ['destinationWalletId'],
      select: { destinationWalletId: true },
    });
    return new Set(
      rows
        .map((row) => row.destinationWalletId)
        .filter((id): id is string => Boolean(id)),
    );
  }

  findById(id: string): Promise<Transaction | null> {
    return this.prisma.transaction.findUnique({ where: { id } });
  }

  listHistory(filter: HistoryFilter): Promise<Transaction[]> {
    const cursorWhere: Prisma.TransactionWhereInput | undefined = filter.cursor
      ? {
          OR: [
            { createdAt: { lt: filter.cursor.createdAt } },
            {
              createdAt: filter.cursor.createdAt,
              id: { lt: filter.cursor.id },
            },
          ],
        }
      : undefined;

    const sourceBranch: Prisma.TransactionWhereInput = {
      sourceWalletId: filter.walletId,
      ...(filter.currency ? { sourceCurrency: filter.currency } : {}),
    };
    const destinationBranch: Prisma.TransactionWhereInput = {
      destinationWalletId: filter.walletId,
      ...(filter.currency ? { destinationCurrency: filter.currency } : {}),
    };

    return this.prisma.transaction.findMany({
      where: {
        AND: [
          { OR: [sourceBranch, destinationBranch] },
          ...(filter.type ? [{ type: filter.type }] : []),
          ...(cursorWhere ? [cursorWhere] : []),
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
    });
  }
}

export function lockedBalance(
  balances: Map<string, LockedBalance>,
  walletId: string,
  currency: Currency,
): LockedBalance {
  return balances.get(`${walletId}:${currency}`)!;
}

export function ensureFunds(
  available: Prisma.Decimal,
  required: Prisma.Decimal,
): void {
  if (available.lt(required)) {
    throw new ApiError(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'INSUFFICIENT_FUNDS',
      'Wallet balance is insufficient for this operation',
    );
  }
}
