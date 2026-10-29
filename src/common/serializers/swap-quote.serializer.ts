import { SwapQuote } from '@prisma/client';
import { amountString, rateString } from '../money';

export function serializeSwapQuote(
  quote: SwapQuote,
  rateAsOf: Date,
): Record<string, unknown> {
  return {
    quoteId: quote.id,
    walletId: quote.walletId,
    sourceCurrency: quote.sourceCurrency,
    sourceAmount: amountString(quote.sourceAmount),
    destinationCurrency: quote.destinationCurrency,
    destinationAmount: amountString(quote.quotedDestinationAmount),
    quotedRate: rateString(quote.quotedRate),
    rateAsOf: rateAsOf.toISOString(),
    expiresAt: quote.expiresAt.toISOString(),
  };
}
