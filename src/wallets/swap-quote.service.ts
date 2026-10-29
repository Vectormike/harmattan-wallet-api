import { HttpStatus, Injectable } from '@nestjs/common';
import { Currency, Prisma, SwapQuote } from '@prisma/client';
import { ApiError } from '../common/api-error';
import {
  amountString,
  crossRate,
  destinationAmount,
  parseAmount,
} from '../common/money';
import { serializeSwapQuote } from '../common/serializers';
import { RuntimeConfigService } from '../config/runtime-config.service';
import { FxService } from '../fx/fx.service';
import { TransactionClient } from '../idempotency/idempotency.repository';
import { TransactionRepository } from '../transactions/transaction.repository';
import { CreateSwapQuoteDto } from './dto/create-swap-quote.dto';
import { WalletRepository } from './wallet.repository';

@Injectable()
export class SwapQuoteService {
  constructor(
    private readonly transactions: TransactionRepository,
    private readonly wallets: WalletRepository,
    private readonly fx: FxService,
    private readonly config: RuntimeConfigService,
  ) {}

  async create(
    walletId: string,
    dto: CreateSwapQuoteDto,
  ): Promise<Record<string, unknown>> {
    if (!(await this.wallets.exists(walletId))) {
      throw new ApiError(
        HttpStatus.NOT_FOUND,
        'WALLET_NOT_FOUND',
        'Wallet was not found',
      );
    }
    if (dto.sourceCurrency === dto.destinationCurrency) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'SAME_CURRENCY_SWAP',
        'Source and destination currencies must differ',
      );
    }

    const sourceAmount = parseAmount(dto.sourceAmount);
    this.enforceCap(dto.sourceCurrency, sourceAmount);
    const snapshot = await this.fx.getSnapshot();
    const rate = crossRate(
      snapshot,
      dto.sourceCurrency,
      dto.destinationCurrency,
    );
    const quotedDestinationAmount = destinationAmount(sourceAmount, rate);
    const expiresAt = new Date(Date.now() + this.config.quoteTtlSeconds * 1000);

    const quote = await this.transactions.createQuote({
      walletId,
      fxSnapshotId: snapshot.id,
      sourceCurrency: dto.sourceCurrency,
      destinationCurrency: dto.destinationCurrency,
      sourceAmount,
      quotedRate: rate,
      quotedDestinationAmount,
      expiresAt,
    });

    return serializeSwapQuote(quote, snapshot.rateAsOf);
  }

  async requireInTransaction(
    tx: TransactionClient,
    quoteId: string,
    walletId: string,
  ): Promise<SwapQuote> {
    const quote = await this.transactions.findQuoteInTransaction(tx, quoteId);
    if (!quote || quote.walletId !== walletId) {
      throw new ApiError(
        HttpStatus.NOT_FOUND,
        'QUOTE_NOT_FOUND',
        'Swap quote was not found for that wallet',
      );
    }
    if (quote.expiresAt.getTime() <= Date.now()) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'FX_QUOTE_EXPIRED',
        'Swap quote has expired; request a new quote',
      );
    }
    this.enforceCap(quote.sourceCurrency, quote.sourceAmount);
    return quote;
  }

  private enforceCap(currency: Currency, sourceAmount: Prisma.Decimal): void {
    const cap = this.config.swapCap(currency);
    if (sourceAmount.gt(cap)) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'SWAP_AMOUNT_LIMIT_EXCEEDED',
        'Source amount exceeds the configured cap for this currency',
        {
          sourceCurrency: currency,
          sourceAmount: amountString(sourceAmount),
          maximum: amountString(cap),
        },
      );
    }
  }
}
