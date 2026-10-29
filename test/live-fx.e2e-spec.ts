import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Currency, FxSource } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service';
import {
  closeE2eTestContext,
  createE2eTestContext,
  E2eTestContext,
  resetDatabase,
} from './e2e-test-context';

interface RateResponseItem {
  base: Currency;
  quote: Currency;
  rate: string;
}

describe('Live FX provider behaviors', () => {
  const rateAsOfUnix = Math.floor(Date.now() / 1000) - 60;
  const nextRefreshUnix = Math.floor(Date.now() / 1000) + 3600;
  let context: E2eTestContext;
  let app: INestApplication;
  let prisma: PrismaService;
  let provider: Server;
  let providerRequests = 0;

  beforeAll(async () => {
    provider = createServer((_request, response) => {
      providerRequests += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          result: 'success',
          provider: 'Test FX Provider',
          time_last_update_unix: rateAsOfUnix,
          time_next_update_unix: nextRefreshUnix,
          rates: {
            NGN: 1600,
            GHS: 15.5,
            XAF: 610,
            EUR: 0.92,
          },
        }),
      );
    });
    await new Promise<void>((resolve) => {
      provider.listen(0, '127.0.0.1', resolve);
    });
    const address = provider.address() as AddressInfo;
    context = await createE2eTestContext({
      fxProviderUrl: `http://127.0.0.1:${address.port}/latest/USD`,
    });
    ({ app, prisma } = context);
  }, 120_000);

  beforeEach(async () => {
    providerRequests = 0;
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await closeE2eTestContext(context);
    await new Promise<void>((resolve, reject) => {
      provider.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('persists a live snapshot with provider refresh timestamps', async () => {
    const first = await request(app.getHttpServer())
      .get('/v1/rates')
      .expect(200);
    const second = await request(app.getHttpServer())
      .get('/v1/rates')
      .expect(200);

    expect(first.body).toMatchObject({
      source: 'live',
      provider: 'Test FX Provider',
      freshness: 'fresh',
      rateAsOf: new Date(rateAsOfUnix * 1000).toISOString(),
    });
    expect(first.body.fetchedAt).toEqual(expect.any(String));
    expect(second.body.snapshotId).toBe(first.body.snapshotId);
    expect(providerRequests).toBe(1);

    const persisted = await prisma.fxSnapshot.findUniqueOrThrow({
      where: { id: first.body.snapshotId },
    });
    expect(persisted.source).toBe(FxSource.LIVE);
    expect(persisted.provider).toBe('Test FX Provider');
    expect(persisted.rateAsOf.toISOString()).toBe(
      new Date(rateAsOfUnix * 1000).toISOString(),
    );
    expect(persisted.nextRefreshAt.toISOString()).toBe(
      new Date(nextRefreshUnix * 1000).toISOString(),
    );
    expect(persisted.fetchedAt).toBeInstanceOf(Date);
  });

  it('returns every unique supported currency pair', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/rates')
      .expect(200);
    const currencies = Object.values(Currency);
    const expectedPairs = new Set(
      currencies.flatMap((base) =>
        currencies.map((quote) => `${base}:${quote}`),
      ),
    );
    const rates = response.body.rates as RateResponseItem[];
    const actualPairs = new Set(
      rates.map((rate) => `${rate.base}:${rate.quote}`),
    );

    expect(rates).toHaveLength(25);
    expect(actualPairs).toEqual(expectedPairs);
    expect(rates.every((rate) => /^\d+\.\d{18}$/.test(rate.rate))).toBe(true);
  });
});
