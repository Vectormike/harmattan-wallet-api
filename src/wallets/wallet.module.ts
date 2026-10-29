import { Module } from '@nestjs/common';
import { FxModule } from '../fx/fx.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { TransactionModule } from '../transactions/transaction.module';
import { DepositController } from './deposit.controller';
import { DepositService } from './deposit.service';
import { SoftSignalService } from './soft-signal.service';
import { SwapController } from './swap.controller';
import { SwapQuoteService } from './swap-quote.service';
import { SwapService } from './swap.service';
import { TransferController } from './transfer.controller';
import { TransferService } from './transfer.service';
import { WalletController } from './wallet.controller';
import { WalletHistoryController } from './wallet-history.controller';
import { WalletHistoryService } from './wallet-history.service';
import { WalletRepository } from './wallet.repository';
import { WalletService } from './wallet.service';

@Module({
  imports: [FxModule, IdempotencyModule, TransactionModule],
  controllers: [
    WalletController,
    WalletHistoryController,
    DepositController,
    SwapController,
    TransferController,
  ],
  providers: [
    WalletService,
    WalletHistoryService,
    WalletRepository,
    DepositService,
    SwapQuoteService,
    SwapService,
    TransferService,
    SoftSignalService,
  ],
  exports: [WalletService, WalletRepository],
})
export class WalletModule {}
