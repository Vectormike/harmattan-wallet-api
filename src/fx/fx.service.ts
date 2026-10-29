import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Currency, FxSnapshot, FxSource, Prisma } from '@prisma/client';
import { isLosslessNumber, parse } from 'lossless-json';
import { RuntimeConfigService } from '../config/runtime-config.service';
import { crossRate, rateString, SUPPORTED_CURRENCIES } from '../common/money';
import { ApiError } from '../common/api-error';
import { HttpStatus } from '@nestjs/common';
import { FxSnapshotRepository } from './fx-snapshot.repository';

export interface ResolvedRate {
  rate: Prisma.Decimal;
  source: FxSource;
  rateAsOf: Date | null;
  snapshot: FxSnapshot | null;
}

type JsonRecord = Record<string, unknown>;

@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);

  constructor(
    private readonly snapshots: FxSnapshotRepository,
    private readonly config: RuntimeConfigService,
  ) {}

  async getSnapshot(): Promise<FxSnapshot> {
    const current = await this.snapshots.latest();
    if (current && current.nextRefreshAt.getTime() > Date.now()) {
      return current;
    }
    return this.refreshSingleFlight(current?.id);
  }

  async resolveRate(
    source: Currency,
    destination: Currency,
  ): Promise<ResolvedRate> {
    if (source === destination) {
      return {
        rate: new Prisma.Decimal(1),
        source: FxSource.IDENTITY,
        rateAsOf: null,
        snapshot: null,
      };
    }
    const snapshot = await this.getSnapshot();
    return {
      rate: crossRate(snapshot, source, destination),
      source: snapshot.source,
      rateAsOf: snapshot.rateAsOf,
      snapshot,
    };
  }

  async ratesResponse(): Promise<Record<string, unknown>> {
    const snapshot = await this.getSnapshot();
    const rates = SUPPORTED_CURRENCIES.flatMap((base) =>
      SUPPORTED_CURRENCIES.map((quote) => ({
        base,
        quote,
        rate: rateString(crossRate(snapshot, base, quote)),
      })),
    );

    return {
      snapshotId: snapshot.id,
      source: snapshot.source.toLowerCase(),
      provider: snapshot.provider,
      rateAsOf: snapshot.rateAsOf.toISOString(),
      fetchedAt: snapshot.fetchedAt.toISOString(),
      freshness: snapshot.freshness,
      rates,
      ...(snapshot.lastLiveSnapshotId
        ? {
            lastLive: {
              snapshotId: snapshot.lastLiveSnapshotId,
              provider: snapshot.lastLiveProvider,
              rateAsOf: snapshot.lastLiveRateAsOf?.toISOString(),
            },
          }
        : {}),
    };
  }

  private async refreshSingleFlight(previousId?: string): Promise<FxSnapshot> {
    const handle = await this.snapshots.tryRefreshLock();
    if (!handle.acquired) {
      return this.waitForWinner(previousId);
    }

    try {
      const current = await this.snapshots.latest();
      if (current && current.nextRefreshAt.getTime() > Date.now()) {
        return current;
      }

      try {
        const input = await this.fetchLiveSnapshot();
        return await this.snapshots.persistLiveIfNewer(input);
      } catch (error) {
        this.logger.warn(
          `FX refresh failed; using fixed fallback: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return await this.snapshots.fixedFallback();
      }
    } finally {
      await handle.release();
    }
  }

  private async waitForWinner(previousId?: string): Promise<FxSnapshot> {
    const deadline = Date.now() + this.config.fxRefreshWaitTimeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const latest = await this.snapshots.latest();
      if (latest && latest.id !== previousId) {
        return latest;
      }
    }

    const latest = await this.snapshots.latest();
    if (latest && latest.nextRefreshAt.getTime() > Date.now()) {
      return latest;
    }
    try {
      return await this.snapshots.fixedFallback();
    } catch {
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'FX_UNAVAILABLE',
        'No live or fixed FX rates are available',
      );
    }
  }

  private async fetchLiveSnapshot(): Promise<{
    provider: string;
    ngnPerUsd: Prisma.Decimal;
    ghsPerUsd: Prisma.Decimal;
    xafPerUsd: Prisma.Decimal;
    eurPerUsd: Prisma.Decimal;
    rateAsOf: Date;
    nextRefreshAt: Date;
  }> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.fxRequestTimeoutMs,
    );

    try {
      const response = await fetch(this.config.fxProviderUrl, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (!response.ok) {
        throw new ServiceUnavailableException(
          `FX provider returned HTTP ${response.status}`,
        );
      }

      const body = parse(await response.text()) as JsonRecord;
      if (body.result !== 'success') {
        throw new Error('FX provider returned an unsuccessful result');
      }

      const rates = this.record(body.rates, 'rates');
      const rateAsOf = this.unixDate(
        body.time_last_update_unix,
        'time_last_update_unix',
      );
      const nextRefreshAt = this.unixDate(
        body.time_next_update_unix,
        'time_next_update_unix',
      );

      return {
        provider:
          typeof body.provider === 'string'
            ? body.provider
            : 'ExchangeRate-API',
        ngnPerUsd: this.positiveDecimal(rates.NGN, 'NGN'),
        ghsPerUsd: this.positiveDecimal(rates.GHS, 'GHS'),
        xafPerUsd: this.positiveDecimal(rates.XAF, 'XAF'),
        eurPerUsd: this.positiveDecimal(rates.EUR, 'EUR'),
        rateAsOf,
        nextRefreshAt,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private record(value: unknown, field: string): JsonRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`FX provider field ${field} is invalid`);
    }
    return value as JsonRecord;
  }

  private positiveDecimal(value: unknown, currency: string): Prisma.Decimal {
    if (value === undefined || value === null) {
      throw new Error(`FX provider omitted ${currency}`);
    }
    const decimal = new Prisma.Decimal(this.numericString(value, currency));
    if (decimal.lte(0)) {
      throw new Error(`FX provider returned invalid ${currency} rate`);
    }
    return decimal;
  }

  private unixDate(value: unknown, field: string): Date {
    const seconds = Number(this.numericString(value, field));
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new Error(`FX provider field ${field} is invalid`);
    }
    return new Date(seconds * 1000);
  }

  private numericString(value: unknown, field: string): string {
    if (typeof value === 'number' || typeof value === 'string') {
      return String(value);
    }
    if (isLosslessNumber(value)) {
      return value.value;
    }
    throw new Error(`FX provider field ${field} is not numeric`);
  }
}
