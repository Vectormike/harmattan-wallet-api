import { HttpStatus, Injectable } from '@nestjs/common';
import { TransactionType } from '@prisma/client';
import { amountString, parseAmount } from '../common/money';
import { serializeTransaction } from '../common/serializers';
import {
  IdempotentResult,
  IdempotencyService,
} from '../idempotency/idempotency.service';
import {
  lockedBalance,
  TransactionRepository,
} from '../transactions/transaction.repository';
import { DepositDto } from './dto/deposit.dto';
import { SoftSignalService } from './soft-signal.service';
import { WalletService } from './wallet.service';

@Injectable()
export class DepositService {
  constructor(
    private readonly wallets: WalletService,
    private readonly transactions: TransactionRepository,
    private readonly idempotency: IdempotencyService,
    private readonly signals: SoftSignalService,
  ) {}

  async deposit(
    walletId: string,
    dto: DepositDto,
    key: string,
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    await this.wallets.requireWallet(walletId);
    const amount = parseAmount(dto.amount);
    const scope = `deposit:${walletId}`;
    const request = { walletId, currency: dto.currency, amount: dto.amount };
    const replay = await this.idempotency.replayIfExists<
      Record<string, unknown>
    >(scope, key, request);
    if (replay) return replay;

    return this.idempotency.execute(scope, key, request, async (tx) => {
      await this.signals.checkDeposit(walletId, dto.currency, amount);
      const balances = await this.transactions.lockBalances(tx, [
        { walletId, currency: dto.currency },
      ]);
      const current = lockedBalance(balances, walletId, dto.currency).available;
      const balanceAfter = current.add(amount);
      await this.transactions.setBalance(
        tx,
        walletId,
        dto.currency,
        balanceAfter,
      );
      const transaction = await this.transactions.createTransaction(tx, {
        type: TransactionType.DEPOSIT,
        sourceWalletId: null,
        destinationWalletId: walletId,
        sourceCurrency: dto.currency,
        sourceAmount: amount,
        destinationCurrency: dto.currency,
        destinationAmount: amount,
      });

      return {
        status: HttpStatus.CREATED,
        body: {
          transaction: serializeTransaction(transaction),
          balance: {
            walletId,
            currency: dto.currency,
            available: amountString(balanceAfter),
          },
        },
        transactionId: transaction.id,
      };
    });
  }
}
