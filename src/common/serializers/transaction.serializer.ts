import { Transaction } from '@prisma/client';
import { amountString, rateString } from '../money';

export function serializeTransaction(
  transaction: Transaction,
): Record<string, unknown> {
  return {
    id: transaction.id,
    type: transaction.type.toLowerCase(),
    senderWalletId: transaction.sourceWalletId,
    receiverWalletId: transaction.destinationWalletId,
    sourceAmount: amountString(transaction.sourceAmount),
    sourceCurrency: transaction.sourceCurrency,
    destinationAmount: amountString(transaction.destinationAmount),
    destinationCurrency: transaction.destinationCurrency,
    rate: transaction.appliedRate ? rateString(transaction.appliedRate) : null,
    rateAsOf: transaction.rateAsOf?.toISOString() ?? null,
    rateSource: transaction.fxSource?.toLowerCase() ?? null,
    fxSnapshotId: transaction.fxSnapshotId,
    timestamp: transaction.createdAt.toISOString(),
  };
}
