import { HttpStatus, Injectable } from '@nestjs/common';
import { TransactionType } from '@prisma/client';
import { ApiError } from '../common/api-error';
import {
  amountString,
  crossRate,
  destinationAmount,
  movementBps,
  rateString,
} from '../common/money';
import { serializeTransaction } from '../common/serializers';
import { RuntimeConfigService } from '../config/runtime-config.service';
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
import { ExecuteSwapDto } from './dto/execute-swap.dto';
import { SwapQuoteService } from './swap-quote.service';
import { WalletService } from './wallet.service';

@Injectable()
export class SwapService {
  constructor(
    private readonly transactions: TransactionRepository,
    private readonly wallets: WalletService,
    private readonly quotes: SwapQuoteService,
    private readonly fx: FxService,
    private readonly idempotency: IdempotencyService,
    private readonly config: RuntimeConfigService,
  ) {}

  async execute(
    walletId: string,
    dto: ExecuteSwapDto,
    key: string,
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    await this.wallets.requireWallet(walletId);
    const scope = `swap:${walletId}`;
    const request = { walletId, quoteId: dto.quoteId };
    const replay = await this.idempotency.replayIfExists<
      Record<string, unknown>
    >(scope, key, request);
    if (replay) return replay;

    await this.fx.getSnapshot();

    return this.idempotency.execute(scope, key, request, async (tx) => {
      const quote = await this.quotes.requireInTransaction(
        tx,
        dto.quoteId,
        walletId,
      );
      const snapshot = await tx.fxSnapshot.findFirst({
        orderBy: [{ fetchedAt: 'desc' }, { id: 'desc' }],
      });
      if (!snapshot) {
        throw new ApiError(
          HttpStatus.SERVICE_UNAVAILABLE,
          'FX_UNAVAILABLE',
          'No FX snapshot is available',
        );
      }
      const executionRate = crossRate(
        snapshot,
        quote.sourceCurrency,
        quote.destinationCurrency,
      );
      const observedMovement = movementBps(quote.quotedRate, executionRate);
      if (observedMovement.gt(this.config.maxRateDeviationBps)) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'FX_RATE_MOVED',
          'The FX rate moved beyond the allowed threshold; request a new quote',
          {
            quoteId: quote.id,
            quotedRate: rateString(quote.quotedRate),
            executionRate: rateString(executionRate),
            movementBps: observedMovement.toDecimalPlaces(4).toString(),
            maximumBps: this.config.maxRateDeviationBps,
          },
        );
      }

      const converted = destinationAmount(quote.sourceAmount, executionRate);
      const balances = await this.transactions.lockBalances(tx, [
        { walletId, currency: quote.sourceCurrency },
        { walletId, currency: quote.destinationCurrency },
      ]);
      const source = lockedBalance(
        balances,
        walletId,
        quote.sourceCurrency,
      ).available;
      const destination = lockedBalance(
        balances,
        walletId,
        quote.destinationCurrency,
      ).available;
      ensureFunds(source, quote.sourceAmount);

      const sourceAfter = source.sub(quote.sourceAmount);
      const destinationAfter = destination.add(converted);
      await this.transactions.setBalance(
        tx,
        walletId,
        quote.sourceCurrency,
        sourceAfter,
      );
      await this.transactions.setBalance(
        tx,
        walletId,
        quote.destinationCurrency,
        destinationAfter,
      );
      const transaction = await this.transactions.createTransaction(tx, {
        type: TransactionType.SWAP,
        sourceWalletId: walletId,
        destinationWalletId: walletId,
        sourceCurrency: quote.sourceCurrency,
        sourceAmount: quote.sourceAmount,
        destinationCurrency: quote.destinationCurrency,
        destinationAmount: converted,
        appliedRate: executionRate,
        rateAsOf: snapshot.rateAsOf,
        fxSource: snapshot.source,
        fxSnapshotId: snapshot.id,
      });
      return {
        status: HttpStatus.CREATED,
        body: {
          transaction: serializeTransaction(transaction),
          balances: {
            [quote.sourceCurrency]: amountString(sourceAfter),
            [quote.destinationCurrency]: amountString(destinationAfter),
          },
        },
        transactionId: transaction.id,
      };
    });
  }
}
