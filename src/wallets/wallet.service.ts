import { HttpStatus, Injectable } from '@nestjs/common';
import { Currency, Prisma } from '@prisma/client';
import { ApiError } from '../common/api-error';
import { crossRate, ZERO } from '../common/money';
import { serializeWallet } from '../common/serializers';
import { FxService } from '../fx/fx.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { WalletRepository, WalletWithBalances } from './wallet.repository';

@Injectable()
export class WalletService {
  constructor(
    private readonly wallets: WalletRepository,
    private readonly fx: FxService,
  ) {}

  async create(dto: CreateWalletDto): Promise<Record<string, unknown>> {
    const email = dto.email?.trim().toLowerCase();
    const mobile = dto.mobile?.trim();
    if (!email && !mobile) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'WALLET_IDENTIFIER_REQUIRED',
        'Provide an email, a mobile number, or both',
      );
    }

    try {
      const wallet = await this.wallets.create(email, mobile);
      return serializeWallet(wallet, ZERO);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'WALLET_IDENTIFIER_EXISTS',
          'A wallet already exists for that email or mobile number',
        );
      }
      throw error;
    }
  }

  async get(id: string): Promise<Record<string, unknown>> {
    const wallet = await this.requireWallet(id);
    const snapshot = await this.fx.getSnapshot();
    const total = wallet.balances
      .reduce(
        (sum, balance) =>
          sum.add(
            balance.available.mul(
              crossRate(snapshot, balance.currency, Currency.USDx),
            ),
          ),
        ZERO,
      )
      .toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_UP);

    return {
      ...serializeWallet(wallet, total),
      valuation: {
        currency: Currency.USDx,
        snapshotId: snapshot.id,
        source: snapshot.source.toLowerCase(),
        rateAsOf: snapshot.rateAsOf.toISOString(),
      },
    };
  }

  async requireWallet(id: string): Promise<WalletWithBalances> {
    const wallet = await this.wallets.findById(id);
    if (!wallet) {
      throw new ApiError(
        HttpStatus.NOT_FOUND,
        'WALLET_NOT_FOUND',
        'Wallet was not found',
      );
    }
    return wallet;
  }
}
