import { Injectable } from '@nestjs/common';
import { Currency, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { SUPPORTED_CURRENCIES } from '../common/money';

const walletWithBalances = {
  balances: {
    orderBy: { currency: Prisma.SortOrder.asc },
  },
} satisfies Prisma.WalletInclude;

export type WalletWithBalances = Prisma.WalletGetPayload<{
  include: typeof walletWithBalances;
}>;

@Injectable()
export class WalletRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(email?: string, mobile?: string): Promise<WalletWithBalances> {
    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.create({
        data: { email, mobile },
      });
      await tx.walletBalance.createMany({
        data: SUPPORTED_CURRENCIES.map((currency: Currency) => ({
          walletId: wallet.id,
          currency,
        })),
      });
      return tx.wallet.findUniqueOrThrow({
        where: { id: wallet.id },
        include: walletWithBalances,
      });
    });
  }

  findById(id: string): Promise<WalletWithBalances | null> {
    return this.prisma.wallet.findUnique({
      where: { id },
      include: walletWithBalances,
    });
  }

  async exists(id: string): Promise<boolean> {
    return (await this.prisma.wallet.count({ where: { id } })) === 1;
  }
}
