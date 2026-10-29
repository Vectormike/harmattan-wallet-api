import { HttpStatus } from '@nestjs/common';
import { Currency, FxSnapshot, Prisma } from '@prisma/client';
import { ApiError } from './api-error';

export const SUPPORTED_CURRENCIES = Object.values(Currency);
export const ZERO = new Prisma.Decimal(0);
export const ONE = new Prisma.Decimal(1);
export const MAX_AMOUNT = new Prisma.Decimal('99999999999999999999.99999999');

const AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/;

export function parseAmount(value: string): Prisma.Decimal {
  if (!AMOUNT_PATTERN.test(value)) {
    throw new ApiError(
      HttpStatus.BAD_REQUEST,
      'INVALID_AMOUNT',
      'Amount must be a positive decimal string with at most 8 decimal places',
    );
  }

  const amount = new Prisma.Decimal(value);
  if (amount.lte(ZERO)) {
    throw new ApiError(
      HttpStatus.BAD_REQUEST,
      'INVALID_AMOUNT',
      'Amount must be greater than zero',
    );
  }
  if (amount.gt(MAX_AMOUNT)) {
    throw new ApiError(
      HttpStatus.BAD_REQUEST,
      'AMOUNT_OUT_OF_RANGE',
      'Amount exceeds the supported maximum',
    );
  }
  return amount;
}

export function destinationAmount(
  sourceAmount: Prisma.Decimal,
  rate: Prisma.Decimal,
): Prisma.Decimal {
  const result = sourceAmount
    .mul(rate)
    .toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_UP);

  if (result.lte(ZERO)) {
    throw new ApiError(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'CONVERTED_AMOUNT_TOO_SMALL',
      'Converted destination amount rounds to zero',
    );
  }
  if (result.gt(MAX_AMOUNT)) {
    throw new ApiError(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'AMOUNT_OUT_OF_RANGE',
      'Converted destination amount exceeds the supported maximum',
    );
  }
  return result;
}

export function unitsPerUsd(
  snapshot: Pick<
    FxSnapshot,
    'ngnPerUsd' | 'ghsPerUsd' | 'xafPerUsd' | 'eurPerUsd'
  >,
  currency: Currency,
): Prisma.Decimal {
  const rates: Record<Currency, Prisma.Decimal> = {
    [Currency.cNGN]: snapshot.ngnPerUsd,
    [Currency.cGHS]: snapshot.ghsPerUsd,
    [Currency.cXAF]: snapshot.xafPerUsd,
    [Currency.USDx]: ONE,
    [Currency.EURx]: snapshot.eurPerUsd,
  };
  return rates[currency];
}

export function crossRate(
  snapshot: Pick<
    FxSnapshot,
    'ngnPerUsd' | 'ghsPerUsd' | 'xafPerUsd' | 'eurPerUsd'
  >,
  source: Currency,
  destination: Currency,
): Prisma.Decimal {
  if (source === destination) {
    return ONE;
  }
  return unitsPerUsd(snapshot, destination).div(unitsPerUsd(snapshot, source));
}

export function amountString(value: Prisma.Decimal): string {
  return value.toFixed(8);
}

export function rateString(value: Prisma.Decimal): string {
  return value.toDecimalPlaces(18).toFixed(18);
}

export function movementBps(
  quoted: Prisma.Decimal,
  execution: Prisma.Decimal,
): Prisma.Decimal {
  return execution.sub(quoted).abs().div(quoted).mul(10_000);
}
