import { Injectable } from '@nestjs/common';
import { FxSnapshot, FxSource, Prisma } from '@prisma/client';
import { PoolClient } from 'pg';
import { RuntimeConfigService } from '../config/runtime-config.service';
import { PgPoolService } from '../database/pg-pool.service';
import { PrismaService } from '../database/prisma.service';

const FX_REFRESH_LOCK_KEY = 824_671_991;

export interface AdvisoryLockHandle {
  acquired: boolean;
  release(): Promise<void>;
}

export interface LiveSnapshotInput {
  provider: string;
  ngnPerUsd: Prisma.Decimal;
  ghsPerUsd: Prisma.Decimal;
  xafPerUsd: Prisma.Decimal;
  eurPerUsd: Prisma.Decimal;
  rateAsOf: Date;
  nextRefreshAt: Date;
}

@Injectable()
export class FxSnapshotRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pool: PgPoolService,
    private readonly config: RuntimeConfigService,
  ) {}

  latest(): Promise<FxSnapshot | null> {
    return this.prisma.fxSnapshot.findFirst({
      orderBy: [{ fetchedAt: 'desc' }, { id: 'desc' }],
    });
  }

  latestLive(): Promise<FxSnapshot | null> {
    return this.prisma.fxSnapshot.findFirst({
      where: { source: FxSource.LIVE },
      orderBy: [{ rateAsOf: 'desc' }, { fetchedAt: 'desc' }],
    });
  }

  async persistLiveIfNewer(input: LiveSnapshotInput): Promise<FxSnapshot> {
    return this.prisma.$transaction(async (tx) => {
      const latest = await tx.fxSnapshot.findFirst({
        where: { source: FxSource.LIVE },
        orderBy: [{ rateAsOf: 'desc' }, { fetchedAt: 'desc' }],
      });
      if (latest && latest.rateAsOf >= input.rateAsOf) {
        return latest;
      }

      return tx.fxSnapshot.create({
        data: {
          source: FxSource.LIVE,
          provider: input.provider,
          ngnPerUsd: input.ngnPerUsd,
          ghsPerUsd: input.ghsPerUsd,
          xafPerUsd: input.xafPerUsd,
          eurPerUsd: input.eurPerUsd,
          rateAsOf: input.rateAsOf,
          nextRefreshAt: input.nextRefreshAt,
          freshness: 'fresh',
        },
      });
    });
  }

  async fixedFallback(): Promise<FxSnapshot> {
    const provider = `fixed:${this.config.fixedVersion}`;
    const existing = await this.prisma.fxSnapshot.findFirst({
      where: { source: FxSource.FIXED, provider },
      orderBy: { fetchedAt: 'desc' },
    });
    if (existing && existing.nextRefreshAt.getTime() > Date.now()) {
      return existing;
    }

    const lastLive = await this.latestLive();
    const now = new Date();
    const nextRefreshAt = new Date(now.getTime() + 5 * 60 * 1000);
    const rates = this.config.fixedRates;

    return this.prisma.fxSnapshot.create({
      data: {
        source: FxSource.FIXED,
        provider,
        ...rates,
        rateAsOf: now,
        nextRefreshAt,
        freshness: 'fallback',
        lastLiveSnapshotId: lastLive?.id,
        lastLiveProvider: lastLive?.provider,
        lastLiveRateAsOf: lastLive?.rateAsOf,
      },
    });
  }

  async tryRefreshLock(): Promise<AdvisoryLockHandle> {
    const client = await this.pool.connect();
    try {
      const result = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
        [FX_REFRESH_LOCK_KEY],
      );
      const acquired = result.rows[0]?.acquired === true;
      if (!acquired) {
        client.release();
        return {
          acquired: false,
          release: () => Promise.resolve(),
        };
      }
      return {
        acquired: true,
        release: () => this.releaseLock(client),
      };
    } catch (error) {
      client.release(error as Error);
      throw error;
    }
  }

  private async releaseLock(client: PoolClient): Promise<void> {
    try {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [
        FX_REFRESH_LOCK_KEY,
      ]);
      client.release();
    } catch (error) {
      client.release(error as Error);
      throw error;
    }
  }
}
