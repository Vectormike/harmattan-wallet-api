import { Injectable } from '@nestjs/common';
import { Transaction, TransactionType } from '@prisma/client';
import { decodeCursor, encodeCursor } from '../common/cursor';
import { serializeTransaction } from '../common/serializers';
import { TransactionRepository } from '../transactions/transaction.repository';
import { HistoryQueryDto } from './dto/history-query.dto';
import { WalletService } from './wallet.service';

@Injectable()
export class WalletHistoryService {
  constructor(
    private readonly wallets: WalletService,
    private readonly transactions: TransactionRepository,
  ) {}

  async get(
    walletId: string,
    query: HistoryQueryDto,
  ): Promise<Record<string, unknown>> {
    await this.wallets.requireWallet(walletId);
    const cursor = decodeCursor(query.cursor);
    const rows = await this.transactions.listHistory({
      walletId,
      type: query.type,
      currency: query.currency,
      cursor,
      limit: query.limit,
    });
    const hasNextPage = rows.length > query.limit;
    const data = rows.slice(0, query.limit);
    const last = data.at(-1);

    return {
      data: data.map((transaction) => ({
        ...serializeTransaction(transaction),
        direction: this.direction(transaction, walletId),
      })),
      pageInfo: {
        hasNextPage,
        nextCursor:
          hasNextPage && last
            ? encodeCursor({ id: last.id, createdAt: last.createdAt })
            : null,
      },
    };
  }

  private direction(transaction: Transaction, walletId: string): string {
    if (transaction.type === TransactionType.DEPOSIT) return 'credit';
    if (transaction.type === TransactionType.SWAP) return 'internal';
    return transaction.sourceWalletId === walletId ? 'sent' : 'received';
  }
}
