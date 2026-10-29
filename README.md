# Harmattan

Harmattan is a multi-currency stablecoin wallet sandbox built for Cardtonic's **Operation Borderless** backend assessment.

One wallet holds five independent balances:

- `cNGN`
- `cGHS`
- `cXAF`
- `USDx`
- `EURx`

The API supports simulated deposits, in-wallet swaps, wallet-to-wallet transfers, FX rates, stable transaction history, and single-transaction lookup.

## Stack

- Node.js 22 LTS and strict TypeScript
- NestJS
- PostgreSQL 16
- Prisma
- Jest, Supertest, and Testcontainers
- Yarn, ESLint, and Prettier
- Docker and Docker Compose

### Why PostgreSQL?

This is a money system. PostgreSQL provides exact `NUMERIC` values, database checks, unique constraints, ACID transactions, row-level `SELECT ... FOR UPDATE` locks, and advisory locks. Those guarantees are a clearer fit than multi-document MongoDB transactions.

Redis is intentionally absent. The open FX endpoint updates daily, so PostgreSQL is sufficient for snapshot reads and cross-instance refresh coordination without another service to operate.

## Quick start

Prerequisites:

- Docker Desktop with the daemon running
- Docker Compose

Start the complete stack from a fresh clone:

```bash
git clone https://github.com/Vectormike/harmattan-wallet-api.git
cd harmattan-wallet-api
docker compose up
```

This command:

1. Builds the API image.
2. Starts PostgreSQL.
3. Waits for PostgreSQL health.
4. Runs `prisma migrate deploy`.
5. Starts the API.

The API is available at `http://localhost:3000`. PostgreSQL is exposed at `localhost:5433` for optional inspection.

```bash
curl http://localhost:3000/health
```

Database data persists in the `postgres_data` volume. To deliberately reset it:

```bash
docker compose down -v
```

## Local development

Do not commit or overwrite a real `.env`. Copy `.env.example` only if you want local overrides:

```bash
corepack yarn install
cp .env.example .env
corepack yarn prisma migrate deploy
corepack yarn start:dev
```

The Compose stack does not require this copy; it includes safe sandbox defaults.

Useful commands:

```bash
corepack yarn build
corepack yarn lint
corepack yarn typecheck
corepack yarn test:unit
corepack yarn test:e2e
corepack yarn test
```

`yarn test:e2e` starts a real ephemeral PostgreSQL instance through Testcontainers, so Docker must be running.

## API

All amounts and rates are JSON strings to prevent binary floating-point errors.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Database-backed readiness |
| `POST` | `/v1/wallets` | Create a wallet using email, mobile, or both |
| `GET` | `/v1/wallets/:id` | Get all balances and total USDx value |
| `POST` | `/v1/wallets/:id/deposits` | Simulate a deposit |
| `POST` | `/v1/wallets/:id/swaps/quotes` | Create a short-lived swap quote |
| `POST` | `/v1/wallets/:id/swaps` | Execute a quoted swap |
| `POST` | `/v1/transfers` | Transfer in the same or another currency |
| `GET` | `/v1/wallets/:id/transactions` | Paginated and filtered wallet history |
| `GET` | `/v1/transactions/:id` | Get one transaction |
| `GET` | `/v1/rates` | Get the complete 25-rate matrix |

The versioned frontend contract is in:

- `postman/Harmattan-v1.postman_collection.json`
- `postman/Harmattan-local.postman_environment.json`

Import both into Postman and run the folders from top to bottom. The collection captures generated wallet, quote, and transaction IDs.

## Idempotency

Deposit, swap execution, and transfer require `Idempotency-Key`.

- Same key and same body returns the original response without another balance mutation.
- Same key with a different body returns `409 IDEMPOTENCY_KEY_REUSED`.
- A rolled-back operation does not consume the key.
- A crash after commit is safe because the original response is stored with the transaction.

## Money precision

- API amount inputs: decimal strings with at most 8 fractional digits.
- Balances and amounts: `NUMERIC(28,8)`.
- FX rates: `NUMERIC(36,18)`.
- Source amounts are never silently rounded.
- Conversion uses full precision and rounds the destination once, half-up, to 8 places.
- A conversion that rounds to zero is rejected.

## Concurrency

Every money mutation runs in one PostgreSQL transaction.

- Deposit locks one balance row.
- Swap locks two currency rows.
- Transfer locks sender and receiver rows.
- Multiple rows are always locked in deterministic `(wallet_id, currency)` order.
- Insufficient funds are checked after locks are acquired.
- Balance updates, the immutable operation row, and the idempotency result commit or roll back together.

FX refresh uses a PostgreSQL session advisory lock. Only one API instance calls the provider while other instances wait for the winning snapshot.

## FX rates

The live provider is [ExchangeRate-API's open endpoint](https://www.exchangerate-api.com/docs/free):

`https://open.er-api.com/v6/latest/USD`

It requires attribution, updates daily, and rate-limits by public egress IP.

The service:

1. Reuses a persisted snapshot until `time_next_update_unix`.
2. Uses an advisory lock for one cross-instance refresh.
3. Validates USD, NGN, GHS, XAF, and EUR.
4. Derives every pair as `unitsPerUsd(destination) / unitsPerUsd(source)`.
5. Persists only a complete immutable snapshot.
6. Uses the clearly labelled fixed fallback when the provider fails.
7. Returns `503 FX_UNAVAILABLE` if neither source is valid.

## Soft signals

These signals are informational and never reject a valid operation:

- Repeated same-wallet, same-amount deposits within one minute log `DEPOSIT_AMOUNT_WINDOW_SIGNAL`.
- More than five distinct transfer recipients within sixty seconds logs `TRANSFER_VELOCITY_SIGNAL`.

They may optionally add a short pace delay but never return `429` by themselves.

## Data model

- `wallets`
- `wallet_balances` — exactly five rows per wallet
- `transactions` — immutable operation journal
- `idempotency_records`
- `fx_snapshots`
- `swap_quotes`

Custom migration checks enforce non-negative balances, positive amounts/rates, wallet identifiers, and operation-type invariants. History indexes cover wallet role, cursor order, type, and currency filters.

See [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) for diagrams and request sequences.

## Assumptions and limitations

- This is a sandbox; deposits do not call a payment provider.
- The brief explicitly does not require full authentication. UUIDs are identifiers, not authorization.
- There are no external blockchain or bank withdrawals.
- Fixed fallback rates are versioned sandbox configuration, not live market data.
- No deployed URL is required by the assessment.

## With more time

- Add authentication, wallet ownership, RBAC, KYC/AML, and audit access logs.
- Add production metrics and alerting for lock waits, provider failures, and fallback usage.
- Add a dedicated quote/limit administration surface.
- Add provider redundancy and reconciliation jobs.
- Add load tests and production-grade secret management.
