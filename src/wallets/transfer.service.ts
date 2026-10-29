import { HttpStatus, Injectable } from '@nestjs/common';
import { TransactionType } from '@prisma/client';
import { ApiError } from '../common/api-error';
import { amountString, destinationAmount, parseAmount } from '../common/money';
import { serializeTransaction } from '../common/serializers';
import { FxService } from '../fx/fx.service';
import {
  IdempotentResult,
  IdempotencyService,
} from '../idempotency/idempotency.service';
import {
  ensureFunds,
  lockedBalance,
  TransactionRepository,
} from '../transactions/transaction.repository';
import { TransferDto } from './dto/transfer.dto';
import { SoftSignalService } from './soft-signal.service';
import { WalletService } from './wallet.service';

@Injectable()
export class TransferService {
  constructor(
    private readonly transactions: TransactionRepository,
    private readonly wallets: WalletService,
    private readonly fx: FxService,
    private readonly idempotency: IdempotencyService,
    private readonly signals: SoftSignalService,
  ) {}

  async transfer(
    dto: TransferDto,
    key: string,
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    if (dto.senderWalletId === dto.receiverWalletId) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'SAME_WALLET_TRANSFER',
        'Sender and receiver wallets must differ',
      );
    }
    await Promise.all([
      this.wallets.requireWallet(dto.senderWalletId),
      this.wallets.requireWallet(dto.receiverWalletId),
    ]);
    const sourceAmount = parseAmount(dto.sourceAmount);
    const scope = `transfer:${dto.senderWalletId}`;
    const request = { ...dto };
    const replay = await this.idempotency.replayIfExists<
      Record<string, unknown>
    >(scope, key, request);
    if (replay) return replay;

    await this.signals.checkTransfer(dto.senderWalletId, dto.receiverWalletId);
    const resolved = await this.fx.resolveRate(
      dto.sourceCurrency,
      dto.destinationCurrency,
    );
    const converted =
      dto.sourceCurrency === dto.destinationCurrency
        ? sourceAmount
        : destinationAmount(sourceAmount, resolved.rate);

    return this.idempotency.execute(scope, key, request, async (tx) => {
      const balances = await this.transactions.lockBalances(tx, [
        {
          walletId: dto.senderWalletId,
          currency: dto.sourceCurrency,
        },
        {
          walletId: dto.receiverWalletId,
          currency: dto.destinationCurrency,
        },
      ]);
      const source = lockedBalance(
        balances,
        dto.senderWalletId,
        dto.sourceCurrency,
      ).available;
      const destination = lockedBalance(
        balances,
        dto.receiverWalletId,
        dto.destinationCurrency,
      ).available;
      ensureFunds(source, sourceAmount);

      const sourceAfter = source.sub(sourceAmount);
      const destinationAfter = destination.add(converted);
      await this.transactions.setBalance(
        tx,
        dto.senderWalletId,
        dto.sourceCurrency,
        sourceAfter,
      );
      await this.transactions.setBalance(
        tx,
        dto.receiverWalletId,
        dto.destinationCurrency,
        destinationAfter,
      );
      const transaction = await this.transactions.createTransaction(tx, {
        type: TransactionType.TRANSFER,
        sourceWalletId: dto.senderWalletId,
        destinationWalletId: dto.receiverWalletId,
        sourceCurrency: dto.sourceCurrency,
        sourceAmount,
        destinationCurrency: dto.destinationCurrency,
        destinationAmount: converted,
        appliedRate: resolved.rate,
        rateAsOf: resolved.rateAsOf,
        fxSource: resolved.source,
        fxSnapshotId: resolved.snapshot?.id,
      });
      return {
        status: HttpStatus.CREATED,
        body: {
          transaction: serializeTransaction(transaction),
          senderBalance: {
            walletId: dto.senderWalletId,
            currency: dto.sourceCurrency,
            available: amountString(sourceAfter),
          },
          receiverBalance: {
            walletId: dto.receiverWalletId,
            currency: dto.destinationCurrency,
            available: amountString(destinationAfter),
          },
        },
        transactionId: transaction.id,
      };
    });
  }
}
