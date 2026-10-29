import type { INestApplication } from '@nestjs/common';
import { Currency } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service';
import {
  closeE2eTestContext,
  createE2eTestContext,
  E2eTestContext,
  resetDatabase,
} from './e2e-test-context';

describe('Harmattan wallet API', () => {
  let context: E2eTestContext;
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    context = await createE2eTestContext();
    ({ app, prisma } = context);
  }, 120_000);

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => closeE2eTestContext(context));

  it('creates one wallet with five zero balances', async () => {
    const response = await createWallet('amara@example.com');

    expect(response.body.balances).toEqual({
      cGHS: '0.00000000',
      cNGN: '0.00000000',
      cXAF: '0.00000000',
      EURx: '0.00000000',
      USDx: '0.00000000',
    });
  });

  it('credits a deposit exactly once for an idempotent retry', async () => {
    const wallet = await createWallet('deposit@example.com');
    const key = 'deposit-case-0001';
    const first = await request(app.getHttpServer())
      .post(`/v1/wallets/${wallet.body.id}/deposits`)
      .set('Idempotency-Key', key)
      .send({ currency: Currency.cNGN, amount: '100.00' })
      .expect(201);

    const replay = await request(app.getHttpServer())
      .post(`/v1/wallets/${wallet.body.id}/deposits`)
      .set('Idempotency-Key', key)
      .send({ currency: Currency.cNGN, amount: '100.00' })
      .expect(201);

    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);

    const fetched = await request(app.getHttpServer())
      .get(`/v1/wallets/${wallet.body.id}`)
      .expect(200);
    expect(fetched.body.balances.cNGN).toBe('100.00000000');

    await request(app.getHttpServer())
      .post(`/v1/wallets/${wallet.body.id}/deposits`)
      .set('Idempotency-Key', key)
      .send({ currency: Currency.cNGN, amount: '101.00' })
      .expect(409);
  });

  it('quotes and executes an atomic cross-currency swap', async () => {
    const wallet = await createWallet('swap@example.com');
    await deposit(wallet.body.id, Currency.cNGN, '1600', 'swap-fund-0001');

    const quote = await request(app.getHttpServer())
      .post(`/v1/wallets/${wallet.body.id}/swaps/quotes`)
      .send({
        sourceCurrency: Currency.cNGN,
        destinationCurrency: Currency.USDx,
        sourceAmount: '1600',
      })
      .expect(201);

    const swap = await request(app.getHttpServer())
      .post(`/v1/wallets/${wallet.body.id}/swaps`)
      .set('Idempotency-Key', 'swap-execute-0001')
      .send({ quoteId: quote.body.quoteId })
      .expect(201);

    expect(swap.body.transaction.type).toBe('swap');
    expect(swap.body.balances.cNGN).toBe('0.00000000');
    expect(swap.body.balances.USDx).toBe('1.00000000');
  });

  it('transfers cross-currency value between two wallets', async () => {
    const sender = await createWallet('sender@example.com');
    const receiver = await createWallet('receiver@example.com');
    await deposit(sender.body.id, Currency.USDx, '100', 'transfer-fund-0001');

    const transfer = await request(app.getHttpServer())
      .post('/v1/transfers')
      .set('Idempotency-Key', 'transfer-case-0001')
      .send({
        senderWalletId: sender.body.id,
        receiverWalletId: receiver.body.id,
        sourceCurrency: Currency.USDx,
        destinationCurrency: Currency.cGHS,
        sourceAmount: '10',
      })
      .expect(201);

    expect(transfer.body.transaction.type).toBe('transfer');
    expect(transfer.body.senderBalance.available).toBe('90.00000000');
    expect(transfer.body.receiverBalance.available).toBe('155.00000000');
  });

  it('allows only one concurrent transfer to spend the same funds', async () => {
    const sender = await createWallet('race-sender@example.com');
    const receiverA = await createWallet('race-a@example.com');
    const receiverB = await createWallet('race-b@example.com');
    await deposit(sender.body.id, Currency.USDx, '100', 'race-fund-0001');

    const payload = (receiverWalletId: string) => ({
      senderWalletId: sender.body.id,
      receiverWalletId,
      sourceCurrency: Currency.USDx,
      destinationCurrency: Currency.USDx,
      sourceAmount: '80',
    });
    const responses = await Promise.all([
      request(app.getHttpServer())
        .post('/v1/transfers')
        .set('Idempotency-Key', 'race-transfer-0001')
        .send(payload(receiverA.body.id)),
      request(app.getHttpServer())
        .post('/v1/transfers')
        .set('Idempotency-Key', 'race-transfer-0002')
        .send(payload(receiverB.body.id)),
    ]);

    expect(responses.map((result) => result.status).sort()).toEqual([201, 422]);
    const fetched = await request(app.getHttpServer())
      .get(`/v1/wallets/${sender.body.id}`)
      .expect(200);
    expect(fetched.body.balances.USDx).toBe('20.00000000');
  });

  it('rejects missing idempotency keys and missing recipients', async () => {
    const sender = await createWallet('errors@example.com');

    await request(app.getHttpServer())
      .post(`/v1/wallets/${sender.body.id}/deposits`)
      .send({ currency: Currency.USDx, amount: '1' })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
      });

    await request(app.getHttpServer())
      .post('/v1/transfers')
      .set('Idempotency-Key', 'missing-wallet-0001')
      .send({
        senderWalletId: sender.body.id,
        receiverWalletId: '00000000-0000-4000-8000-000000000999',
        sourceCurrency: Currency.USDx,
        destinationCurrency: Currency.USDx,
        sourceAmount: '1',
      })
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('WALLET_NOT_FOUND');
      });
  });

  it('returns an empty first history page without a cursor', async () => {
    const wallet = await createWallet('history@example.com');
    const result = await request(app.getHttpServer())
      .get(`/v1/wallets/${wallet.body.id}/transactions`)
      .expect(200);

    expect(result.body).toEqual({
      data: [],
      pageInfo: { hasNextPage: false, nextCursor: null },
    });
  });

  it('returns the complete 25-entry rate matrix', async () => {
    const result = await request(app.getHttpServer())
      .get('/v1/rates')
      .expect(200);
    expect(result.body.rates).toHaveLength(25);
    expect(result.body.source).toBe('fixed');
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
