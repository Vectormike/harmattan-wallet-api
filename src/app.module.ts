import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { FxModule } from './fx/fx.module';
import { HealthModule } from './health/health.module';
import { TransactionModule } from './transactions/transaction.module';
import { WalletModule } from './wallets/wallet.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    FxModule,
    WalletModule,
    TransactionModule,
    HealthModule,
  ],
})
export class AppModule {}
