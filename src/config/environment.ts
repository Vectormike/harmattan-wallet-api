const POSITIVE_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/;

function scalar(value: unknown, fallback: string | number | boolean): string {
  const selected = value ?? fallback;
  if (
    typeof selected !== 'string' &&
    typeof selected !== 'number' &&
    typeof selected !== 'boolean'
  ) {
    throw new Error('Environment values must be strings, numbers, or booleans');
  }
  return String(selected);
}

function integer(
  env: Record<string, unknown>,
  key: string,
  fallback: number,
): string {
  const value = scalar(env[key], fallback);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return value;
}

function decimal(
  env: Record<string, unknown>,
  key: string,
  fallback: string,
  maxFractionDigits = 18,
): string {
  const value = scalar(env[key], fallback);
  if (!POSITIVE_DECIMAL.test(value) || Number(value) <= 0) {
    throw new Error(`${key} must be a positive decimal string`);
  }

  const fractionLength = value.split('.')[1]?.length ?? 0;
  if (fractionLength > maxFractionDigits) {
    throw new Error(
      `${key} cannot exceed ${maxFractionDigits} fractional digits`,
    );
  }
  return value;
}

function boolean(
  env: Record<string, unknown>,
  key: string,
  fallback: boolean,
): string {
  const value = scalar(env[key], fallback).toLowerCase();
  if (value !== 'true' && value !== 'false') {
    throw new Error(`${key} must be true or false`);
  }
  return value;
}

export function validateEnvironment(
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (!input.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  return {
    ...input,
    NODE_ENV: scalar(input.NODE_ENV, 'development'),
    PORT: integer(input, 'PORT', 3000),
    FX_PROVIDER_URL: scalar(
      input.FX_PROVIDER_URL,
      'https://open.er-api.com/v6/latest/USD',
    ),
    FX_REQUEST_TIMEOUT_MS: integer(input, 'FX_REQUEST_TIMEOUT_MS', 3000),
    FX_REFRESH_WAIT_TIMEOUT_MS: integer(
      input,
      'FX_REFRESH_WAIT_TIMEOUT_MS',
      5000,
    ),
    FX_FIXED_NGN_PER_USD: decimal(input, 'FX_FIXED_NGN_PER_USD', '1600'),
    FX_FIXED_GHS_PER_USD: decimal(input, 'FX_FIXED_GHS_PER_USD', '15.5'),
    FX_FIXED_XAF_PER_USD: decimal(input, 'FX_FIXED_XAF_PER_USD', '610'),
    FX_FIXED_EUR_PER_USD: decimal(input, 'FX_FIXED_EUR_PER_USD', '0.92'),
    FX_FIXED_VERSION: scalar(input.FX_FIXED_VERSION, 'fixed-v1'),
    SWAP_QUOTE_TTL_SECONDS: integer(input, 'SWAP_QUOTE_TTL_SECONDS', 60),
    SWAP_MAX_RATE_DEVIATION_BPS: integer(
      input,
      'SWAP_MAX_RATE_DEVIATION_BPS',
      50,
    ),
    SWAP_MAX_SOURCE_AMOUNT_CNGN: decimal(
      input,
      'SWAP_MAX_SOURCE_AMOUNT_CNGN',
      '10000000',
      8,
    ),
    SWAP_MAX_SOURCE_AMOUNT_CGHS: decimal(
      input,
      'SWAP_MAX_SOURCE_AMOUNT_CGHS',
      '100000',
      8,
    ),
    SWAP_MAX_SOURCE_AMOUNT_CXAF: decimal(
      input,
      'SWAP_MAX_SOURCE_AMOUNT_CXAF',
      '10000000',
      8,
    ),
    SWAP_MAX_SOURCE_AMOUNT_USDX: decimal(
      input,
      'SWAP_MAX_SOURCE_AMOUNT_USDX',
      '10000',
      8,
    ),
    SWAP_MAX_SOURCE_AMOUNT_EURX: decimal(
      input,
      'SWAP_MAX_SOURCE_AMOUNT_EURX',
      '10000',
      8,
    ),
    DEPOSIT_AMOUNT_WINDOW_SECONDS: integer(
      input,
      'DEPOSIT_AMOUNT_WINDOW_SECONDS',
      60,
    ),
    DEPOSIT_SOFT_THROTTLE_ENABLED: boolean(
      input,
      'DEPOSIT_SOFT_THROTTLE_ENABLED',
      false,
    ),
    TRANSFER_VELOCITY_WINDOW_SECONDS: integer(
      input,
      'TRANSFER_VELOCITY_WINDOW_SECONDS',
      60,
    ),
    TRANSFER_DISTINCT_RECIPIENT_THRESHOLD: integer(
      input,
      'TRANSFER_DISTINCT_RECIPIENT_THRESHOLD',
      5,
    ),
    TRANSFER_SOFT_THROTTLE_ENABLED: boolean(
      input,
      'TRANSFER_SOFT_THROTTLE_ENABLED',
      false,
    ),
  };
}
