import { Currency, Prisma } from '@prisma/client';
import {
  amountString,
  crossRate,
  destinationAmount,
  movementBps,
  parseAmount,
} from './money';

const snapshot = {
  ngnPerUsd: new Prisma.Decimal('1600'),
  ghsPerUsd: new Prisma.Decimal('15.5'),
  xafPerUsd: new Prisma.Decimal('610'),
  eurPerUsd: new Prisma.Decimal('0.92'),
};

describe('money helpers', () => {
  it('parses exact decimal amounts without JavaScript number arithmetic', () => {
    expect(amountString(parseAmount('100.12345678'))).toBe('100.12345678');
  });

  it('rejects excess source precision', () => {
    expect(() => parseAmount('1.000000001')).toThrow('at most 8');
  });

  it('derives cross rates from one USD-relative snapshot', () => {
    expect(crossRate(snapshot, Currency.cNGN, Currency.USDx).toString()).toBe(
      '0.000625',
    );
    expect(crossRate(snapshot, Currency.USDx, Currency.cGHS).toString()).toBe(
      '15.5',
    );
  });

  it('rounds the destination once with half-up semantics', () => {
    expect(
      amountString(
        destinationAmount(
          new Prisma.Decimal('1'),
          new Prisma.Decimal('1.123456785'),
        ),
      ),
    ).toBe('1.12345679');
  });

  it('rejects a conversion that rounds to zero', () => {
    expect(() =>
      destinationAmount(
        new Prisma.Decimal('0.00000001'),
        new Prisma.Decimal('0.000625'),
      ),
    ).toThrow('rounds to zero');
  });

  it('measures rate movement in basis points', () => {
    expect(
      movementBps(
        new Prisma.Decimal('1'),
        new Prisma.Decimal('1.0051'),
      ).toString(),
    ).toBe('51');
  });
});
