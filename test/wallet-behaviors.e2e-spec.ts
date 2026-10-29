import type { INestApplication } from '@nestjs/common';
import { Currency, FxSource, TransactionType } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service';
import {
  closeE2eTestContext,
  createE2eTestContext,
  E2eTestContext,
  resetDatabase,
} from './e2e-test-context';

describe('Wallet money behaviors', () => {
  let context: E2eTestContext;
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    context = await createE2eTestContext();
    ({ app, prisma } = context);
  }, 120_000);

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => closeE2eTestContext(context));

  it('exposes the wallet total equivalent in USDx', async () => {
    const wallet = await createWallet('valuation@example.com');
    await deposit(wallet.body.id, Currency.cNGN, '1600', 'valuation-fund-0001');

    const response = await request(app.getHttpServer())
      .get(`/v1/wallets/${wallet.body.id}`)
      .expect(200);

    expect(response.body.totalUsdEquivalent).toBe('1.00000000');
    expect(response.body.valuation).toMatchObject({
      currency: Currency.USDx,
      source: 'fixed',
    });
    expect(response.body.valuation.snapshotId).toEqual(expect.any(String));
    expect(response.body.valuation.rateAsOf).toEqual(expect.any(String));
  });

  it('creates a persisted transaction record for a deposit', async () => {
    const wallet = await createWallet('deposit-record@example.com');
    const response = await deposit(
      wallet.body.id,
      Currency.USDx,
      '12.34',
      'deposit-record-0001',
    );

    expect(response.body.transaction).toMatchObject({
      type: 'deposit',
      senderWalletId: null,
      receiverWalletId: wallet.body.id,
      sourceAmount: '12.34000000',
      sourceCurrency: Currency.USDx,
      destinationAmount: '12.34000000',
      destinationCurrency: Currency.USDx,
      rate: null,
      rateAsOf: null,
      rateSource: null,
      fxSnapshotId: null,
    });

    const persisted = await request(app.getHttpServer())
      .get(`/v1/transactions/${response.body.transaction.id}`)
      .expect(200);
    expect(persisted.body).toEqual(response.body.transaction);
    expect(await prisma.transaction.count()).toBe(1);
  });

  it('falls back and persists when the live rate provider is unreachable', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/rates')
      .expect(200);

    expect(response.body).toMatchObject({
      source: 'fixed',
      provider: 'fixed:fixed-v1',
      freshness: 'fallback',
    });
    expect(response.body.rates).toHaveLength(25);

    const persisted = await prisma.fxSnapshot.findUniqueOrThrow({
      where: { id: response.body.snapshotId },
    });
    expect(persisted.source).toBe(FxSource.FIXED);
    expect(persisted.provider).toBe('fixed:fixed-v1');
  });

  it('rejects an insufficient-funds swap without leaving residue', async () => {
    const wallet = await createWallet('swap-rejection@example.com');
    const quote = await request(app.getHttpServer())
      .post(`/v1/wallets/${wallet.body.id}/swaps/quotes`)
      .send({
        sourceCurrency: Currency.cNGN,
        destinationCurrency: Currency.USDx,
        sourceAmount: '1600',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/v1/wallets/${wallet.body.id}/swaps`)
      .set('Idempotency-Key', 'swap-rejection-0001')
      .send({ quoteId: quote.body.quoteId })
      .expect(422)
      .expect(({ body }) => {
        expect(body.code).toBe('INSUFFICIENT_FUNDS');
      });

    const unchanged = await request(app.getHttpServer())
      .get(`/v1/wallets/${wallet.body.id}`)
      .expect(200);
    expect(unchanged.body.balances.cNGN).toBe('0.00000000');
    expect(unchanged.body.balances.USDx).toBe('0.00000000');
    expect(
      await prisma.transaction.count({
        where: { type: TransactionType.SWAP },
      }),
    ).toBe(0);
    expect(await prisma.idempotencyRecord.count()).toBe(0);
  });

  function createWallet(email: string) {
    return request(app.getHttpServer())
      .post('/v1/wallets')
      .send({ email })
      .expect(201);
  }

  function deposit(
    walletId: string,
    currency: Currency,
    amount: string,
    key: string,
  ) {
    return request(app.getHttpServer())
      .post(`/v1/wallets/${walletId}/deposits`)
      .set('Idempotency-Key', key)
      .send({ currency, amount })
      .expect(201);
  }
});
