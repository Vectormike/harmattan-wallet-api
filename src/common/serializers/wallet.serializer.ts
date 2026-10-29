import { Currency, Prisma } from '@prisma/client';
import { amountString, SUPPORTED_CURRENCIES, ZERO } from '../money';

export type WalletLike = {
  id: string;
  email: string | null;
  mobile: string | null;
  createdAt: Date;
  balances: Array<{
    currency: Currency;
    available: Prisma.Decimal;
  }>;
};

export function serializeWallet(
  wallet: WalletLike,
  totalUsdEquivalent: Prisma.Decimal,
): Record<string, unknown> {
  const balanceMap = Object.fromEntries(
    SUPPORTED_CURRENCIES.map((currency) => [
      currency,
      amountString(
        wallet.balances.find((balance) => balance.currency === currency)
          ?.available ?? ZERO,
      ),
    ]),
  );

  return {
    id: wallet.id,
    email: wallet.email,
    mobile: wallet.mobile,
    balances: balanceMap,
    totalUsdEquivalent: amountString(totalUsdEquivalent),
    createdAt: wallet.createdAt.toISOString(),
  };
}
