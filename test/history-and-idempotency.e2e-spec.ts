import type { INestApplication } from '@nestjs/common';
import { Currency, TransactionType } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service';
import {
  closeE2eTestContext,
  createE2eTestContext,
  E2eTestContext,
  resetDatabase,
} from './e2e-test-context';

interface HistoryItem {
  id: string;
  direction: string;
}

describe('Wallet history and idempotency behaviors', () => {
  let context: E2eTestContext;
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    context = await createE2eTestContext();
    ({ app, prisma } = context);
  }, 120_000);

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => closeE2eTestContext(context));

  it('replays an identical swap without applying it twice', async () => {
    const wallet = await createWallet('swap-replay@example.com');
    await deposit(wallet.body.id, Currency.cNGN, '1600', 'swap-replay-fund');
    const quote = await request(app.getHttpServer())
      .post(`/v1/wallets/${wallet.body.id}/swaps/quotes`)
      .send({
        sourceCurrency: Currency.cNGN,
        destinationCurrency: Currency.USDx,
        sourceAmount: '1600',
      })
      .expect(201);
    const key = 'swap-replay-0001';

    const first = await request(app.getHttpServer())
      .post(`/v1/wallets/${wallet.body.id}/swaps`)
      .set('Idempotency-Key', key)
      .send({ quoteId: quote.body.quoteId })
      .expect(201);
    const replay = await request(app.getHttpServer())
      .post(`/v1/wallets/${wallet.body.id}/swaps`)
      .set('Idempotency-Key', key)
      .send({ quoteId: quote.body.quoteId })
      .expect(201);

    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);
    const walletAfter = await request(app.getHttpServer())
      .get(`/v1/wallets/${wallet.body.id}`)
      .expect(200);
    expect(walletAfter.body.balances.cNGN).toBe('0.00000000');
    expect(walletAfter.body.balances.USDx).toBe('1.00000000');
    expect(
      await prisma.transaction.count({
        where: { type: TransactionType.SWAP },
      }),
    ).toBe(1);
  });

  it('lists mixed wallet history newest first and filters by type and currency', async () => {
    const wallet = await createWallet('history-owner@example.com');
    const counterparty = await createWallet('history-counterparty@example.com');
    const depositResult = await deposit(
      wallet.body.id,
      Currency.cNGN,
      '3200',
      'history-deposit-0001',
    );
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
      .set('Idempotency-Key', 'history-swap-0001')
      .send({ quoteId: quote.body.quoteId })
      .expect(201);
    const sent = await transfer(
      {
        senderWalletId: wallet.body.id,
        receiverWalletId: counterparty.body.id,
        sourceCurrency: Currency.USDx,
        destinationCurrency: Currency.cGHS,
        sourceAmount: '0.25',
      },
      'history-sent-0001',
    );
    const received = await transfer(
      {
        senderWalletId: counterparty.body.id,
        receiverWalletId: wallet.body.id,
        sourceCurrency: Currency.cGHS,
        destinationCurrency: Currency.USDx,
        sourceAmount: '1',
      },
      'history-received-0001',
    );

    const chronologicalIds = [
      depositResult.body.transaction.id,
      swap.body.transaction.id,
      sent.body.transaction.id,
      received.body.transaction.id,
    ];
    await prisma.$transaction(
      chronologicalIds.map((id, index) =>
        prisma.transaction.update({
          where: { id },
          data: {
            createdAt: new Date(`2026-01-01T00:00:0${index + 1}.000Z`),
          },
        }),
      ),
    );

    const history = await request(app.getHttpServer())
      .get(`/v1/wallets/${wallet.body.id}/transactions`)
      .expect(200);
    const historyItems = history.body.data as HistoryItem[];
    expect(historyItems.map((item) => item.id)).toEqual(
      [...chronologicalIds].reverse(),
    );
    expect(historyItems.map((item) => item.direction)).toEqual([
      'received',
      'sent',
      'internal',
      'credit',
    ]);

    const transfers = await request(app.getHttpServer())
      .get(`/v1/wallets/${wallet.body.id}/transactions`)
      .query({ type: TransactionType.TRANSFER })
      .expect(200);
    const transferItems = transfers.body.data as HistoryItem[];
    expect(transferItems.map((item) => item.id)).toEqual([
      received.body.transaction.id,
      sent.body.transaction.id,
    ]);

    const usdHistory = await request(app.getHttpServer())
      .get(`/v1/wallets/${wallet.body.id}/transactions`)
      .query({ currency: Currency.USDx })
      .expect(200);
    const usdItems = usdHistory.body.data as HistoryItem[];
    expect(usdItems.map((item) => item.id)).toEqual([
      received.body.transaction.id,
      sent.body.transaction.id,
      swap.body.transaction.id,
    ]);
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

  function transfer(
    body: {
      senderWalletId: string;
      receiverWalletId: string;
      sourceCurrency: Currency;
      destinationCurrency: Currency;
      sourceAmount: string;
    },
    key: string,
  ) {
    return request(app.getHttpServer())
      .post('/v1/transfers')
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
  }
});
