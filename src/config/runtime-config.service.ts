import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Currency, Prisma } from '@prisma/client';

@Injectable()
export class RuntimeConfigService {
  constructor(private readonly config: ConfigService) {}

  get port(): number {
    return this.number('PORT');
  }

  get databaseUrl(): string {
    return this.config.getOrThrow<string>('DATABASE_URL');
  }

  get fxProviderUrl(): string {
    return this.config.getOrThrow<string>('FX_PROVIDER_URL');
  }

  get fxRequestTimeoutMs(): number {
    return this.number('FX_REQUEST_TIMEOUT_MS');
  }

  get fxRefreshWaitTimeoutMs(): number {
    return this.number('FX_REFRESH_WAIT_TIMEOUT_MS');
  }

  get quoteTtlSeconds(): number {
    return this.number('SWAP_QUOTE_TTL_SECONDS');
  }

  get maxRateDeviationBps(): number {
    return this.number('SWAP_MAX_RATE_DEVIATION_BPS');
  }

  get depositAmountWindowSeconds(): number {
    return this.number('DEPOSIT_AMOUNT_WINDOW_SECONDS');
  }

  get depositSoftThrottleEnabled(): boolean {
    return this.boolean('DEPOSIT_SOFT_THROTTLE_ENABLED');
  }

  get transferVelocityWindowSeconds(): number {
    return this.number('TRANSFER_VELOCITY_WINDOW_SECONDS');
  }

  get transferDistinctRecipientThreshold(): number {
    return this.number('TRANSFER_DISTINCT_RECIPIENT_THRESHOLD');
  }

  get transferSoftThrottleEnabled(): boolean {
    return this.boolean('TRANSFER_SOFT_THROTTLE_ENABLED');
  }

  get fixedVersion(): string {
    return this.config.getOrThrow<string>('FX_FIXED_VERSION');
  }

  get fixedRates(): {
    ngnPerUsd: Prisma.Decimal;
    ghsPerUsd: Prisma.Decimal;
    xafPerUsd: Prisma.Decimal;
    eurPerUsd: Prisma.Decimal;
  } {
    return {
      ngnPerUsd: this.decimal('FX_FIXED_NGN_PER_USD'),
      ghsPerUsd: this.decimal('FX_FIXED_GHS_PER_USD'),
      xafPerUsd: this.decimal('FX_FIXED_XAF_PER_USD'),
      eurPerUsd: this.decimal('FX_FIXED_EUR_PER_USD'),
    };
  }

  swapCap(currency: Currency): Prisma.Decimal {
    const keys: Record<Currency, string> = {
      [Currency.cNGN]: 'SWAP_MAX_SOURCE_AMOUNT_CNGN',
      [Currency.cGHS]: 'SWAP_MAX_SOURCE_AMOUNT_CGHS',
      [Currency.cXAF]: 'SWAP_MAX_SOURCE_AMOUNT_CXAF',
      [Currency.USDx]: 'SWAP_MAX_SOURCE_AMOUNT_USDX',
      [Currency.EURx]: 'SWAP_MAX_SOURCE_AMOUNT_EURX',
    };
    return this.decimal(keys[currency]);
  }

  private number(key: string): number {
    return Number(this.config.getOrThrow<string>(key));
  }

  private boolean(key: string): boolean {
    return this.config.getOrThrow<string>(key) === 'true';
  }

  private decimal(key: string): Prisma.Decimal {
    return new Prisma.Decimal(this.config.getOrThrow<string>(key));
  }
}
