import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { ApiExceptionFilter } from '../src/common/api-exception.filter';
import { PrismaService } from '../src/database/prisma.service';

export interface E2eTestContext {
  app: INestApplication;
  container: StartedPostgreSqlContainer;
  prisma: PrismaService;
}

export interface E2eTestContextOptions {
  fxProviderUrl?: string;
}

export async function createE2eTestContext(
  options: E2eTestContextOptions = {},
): Promise<E2eTestContext> {
  const container = await new PostgreSqlContainer('postgres:16.6-bookworm')
    .withDatabase('harmattan_test')
    .withUsername('harmattan')
    .withPassword('harmattan_test')
    .start();

  Object.assign(process.env, {
    DATABASE_URL: container.getConnectionUri(),
    FX_PROVIDER_URL: options.fxProviderUrl ?? 'http://127.0.0.1:1/unavailable',
    FX_REQUEST_TIMEOUT_MS: '100',
    FX_REFRESH_WAIT_TIMEOUT_MS: '500',
    SWAP_QUOTE_TTL_SECONDS: '60',
    SWAP_MAX_RATE_DEVIATION_BPS: '50',
    SWAP_MAX_SOURCE_AMOUNT_CNGN: '10000000',
    SWAP_MAX_SOURCE_AMOUNT_CGHS: '100000',
    SWAP_MAX_SOURCE_AMOUNT_CXAF: '10000000',
    SWAP_MAX_SOURCE_AMOUNT_USDX: '10000',
    SWAP_MAX_SOURCE_AMOUNT_EURX: '10000',
  });

  execFileSync(
    join(process.cwd(), 'node_modules/.bin/prisma'),
    ['migrate', 'deploy'],
    {
      env: {
        ...process.env,
        DATABASE_URL: container.getConnectionUri(),
      },
    },
  );

  const { AppModule } = await import('../src/app.module');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();

  return {
    app,
    container,
    prisma: app.get(PrismaService),
  };
}

export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "idempotency_records",
      "transactions",
      "swap_quotes",
      "wallet_balances",
      "wallets",
      "fx_snapshots"
    CASCADE
  `);
}

export async function closeE2eTestContext(
  context?: E2eTestContext,
): Promise<void> {
  if (!context) return;
  try {
    await context.app.close();
  } finally {
    await context.container.stop();
  }
}
