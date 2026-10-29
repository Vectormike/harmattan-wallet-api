import { Injectable, Logger } from '@nestjs/common';
import { Currency, Prisma } from '@prisma/client';
import { RuntimeConfigService } from '../config/runtime-config.service';
import { TransactionRepository } from '../transactions/transaction.repository';

@Injectable()
export class SoftSignalService {
  private readonly logger = new Logger(SoftSignalService.name);

  constructor(
    private readonly transactions: TransactionRepository,
    private readonly config: RuntimeConfigService,
  ) {}

  async checkDeposit(
    walletId: string,
    currency: Currency,
    amount: Prisma.Decimal,
  ): Promise<boolean> {
    const since = new Date(
      Date.now() - this.config.depositAmountWindowSeconds * 1000,
    );
    const matches = await this.transactions.recentMatchingDeposits(
      walletId,
      amount,
      since,
    );
    if (matches.length === 0) {
      return false;
    }

    this.logger.warn({
      event: 'DEPOSIT_AMOUNT_WINDOW_SIGNAL',
      walletId,
      currency,
      priorOperationIds: matches.map((match) => match.id),
      windowSeconds: this.config.depositAmountWindowSeconds,
    });
    await this.softPace(this.config.depositSoftThrottleEnabled);
    return true;
  }

  async checkTransfer(
    senderWalletId: string,
    receiverWalletId: string,
  ): Promise<boolean> {
    const since = new Date(
      Date.now() - this.config.transferVelocityWindowSeconds * 1000,
    );
    const recipients = await this.transactions.recentTransferRecipients(
      senderWalletId,
      since,
    );
    recipients.add(receiverWalletId);
    if (recipients.size <= this.config.transferDistinctRecipientThreshold) {
      return false;
    }

    this.logger.warn({
      event: 'TRANSFER_VELOCITY_SIGNAL',
      senderWalletId,
      receiverWalletId,
      distinctRecipientCount: recipients.size,
      threshold: this.config.transferDistinctRecipientThreshold,
      windowSeconds: this.config.transferVelocityWindowSeconds,
    });
    await this.softPace(this.config.transferSoftThrottleEnabled);
    return true;
  }

  private async softPace(enabled: boolean): Promise<void> {
    if (enabled) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
