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

### Endpoint walkthrough

The examples below are abridged. Amounts and rates remain strings in every response.

Create a wallet:

```http
POST /v1/wallets
Content-Type: application/json

{ "email": "amara@example.com" }

HTTP/1.1 201 Created
{ "id": "11111111-1111-4111-8111-111111111111", "email": "amara@example.com", "balances": { "cNGN": "0.00000000", "cGHS": "0.00000000", "cXAF": "0.00000000", "USDx": "0.00000000", "EURx": "0.00000000" }, "totalUsdEquivalent": "0.00000000" }
```

Deposit simulated funds:

```http
POST /v1/wallets/11111111-1111-4111-8111-111111111111/deposits
Content-Type: application/json
Idempotency-Key: deposit-example-0001

{ "currency": "cNGN", "amount": "1600.00" }

HTTP/1.1 201 Created
{ "transaction": { "id": "deposit-transaction-id", "type": "deposit" }, "balance": { "walletId": "11111111-1111-4111-8111-111111111111", "currency": "cNGN", "available": "1600.00000000" } }
```

Create and execute a swap quote:

```http
POST /v1/wallets/11111111-1111-4111-8111-111111111111/swaps/quotes
Content-Type: application/json

{ "sourceCurrency": "cNGN", "destinationCurrency": "USDx", "sourceAmount": "1600.00" }

HTTP/1.1 201 Created
{ "quoteId": "swap-quote-id", "sourceAmount": "1600.00000000", "destinationAmount": "1.00000000", "quotedRate": "0.000625000000000000", "expiresAt": "2026-10-29T15:01:00.000Z" }
```

```http
POST /v1/wallets/11111111-1111-4111-8111-111111111111/swaps
Content-Type: application/json
Idempotency-Key: swap-example-0001

{ "quoteId": "swap-quote-id" }

HTTP/1.1 201 Created
{ "transaction": { "id": "swap-transaction-id", "type": "swap" }, "balances": { "cNGN": "0.00000000", "USDx": "1.00000000" } }
```

Transfer between wallets with automatic conversion:

```http
POST /v1/transfers
Content-Type: application/json
Idempotency-Key: transfer-example-0001

{
  "senderWalletId": "11111111-1111-4111-8111-111111111111",
  "receiverWalletId": "22222222-2222-4222-8222-222222222222",
  "sourceCurrency": "USDx",
  "destinationCurrency": "cGHS",
  "sourceAmount": "0.50"
}

HTTP/1.1 201 Created
{ "transaction": { "id": "transfer-transaction-id", "type": "transfer", "sourceAmount": "0.50000000", "destinationAmount": "7.75000000", "rate": "15.500000000000000000" }, "senderBalance": { "currency": "USDx", "available": "0.50000000" }, "receiverBalance": { "currency": "cGHS", "available": "7.75000000" } }
```

Read balances, history, one transaction, and rates:

```http
GET /v1/wallets/11111111-1111-4111-8111-111111111111
GET /v1/wallets/11111111-1111-4111-8111-111111111111/transactions?type=TRANSFER&currency=USDx&limit=20
GET /v1/transactions/transfer-transaction-id
GET /v1/rates
```

Example responses, in the same order:

```text
wallet:      { "id": "1111...", "balances": { "cNGN": "0.00000000", "USDx": "0.50000000" }, "totalUsdEquivalent": "0.50000000", "valuation": { "currency": "USDx", "snapshotId": "fx-snapshot-id" } }
history:     { "data": [{ "id": "transfer-transaction-id", "type": "transfer", "direction": "sent" }], "pageInfo": { "hasNextPage": false, "nextCursor": null } }
transaction: { "id": "transfer-transaction-id", "type": "transfer", "sourceAmount": "0.50000000", "destinationAmount": "7.75000000" }
rates:       { "snapshotId": "fx-snapshot-id", "source": "live", "rateAsOf": "2026-10-29T00:02:31.000Z", "rates": [{ "base": "USDx", "quote": "cGHS", "rate": "11.639916000000000000" }] }
```

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

## Assumptions and known limitations

- This is a sandbox; deposits are simulated and do not call a payment provider.
- The brief explicitly does not require full authentication. UUIDs are identifiers, not authorization, so knowing an ID is sufficient to read its sandbox resources.
- Fixed fallback rates are versioned sandbox configuration, not live market data.
- Soft deposit and transfer signals provide logging and optional pacing, not production fraud controls.
- A deployed URL is not required by the assessment; the supported runtime is Docker Compose.

## What was left out and why

- Authentication, wallet ownership, RBAC, KYC/AML, and real payment rails were excluded because the brief asks for a focused sandbox and explicitly makes full authentication optional.
- External blockchain or bank withdrawals were excluded because they are outside the five requested capabilities.
- Redis, queues, and background workers were excluded because PostgreSQL already provides the required durable state and cross-instance coordination at this scale.
- Kubernetes and cloud deployment were excluded because the deliverable requires a one-command local Docker environment, not a hosted URL.

## With more time

- Add authenticated identities, wallet ownership, RBAC, KYC/AML workflows, and audit access logs.
- Add production metrics and alerts for row-lock waits, provider failures, fallback usage, and reconciliation drift.
- Add a dedicated administration surface for quote limits, fallback-rate versions, and operational review.
- Add a second FX provider, reconciliation jobs, and tested provider failover.
- Add load tests, broader concurrency coverage, and production-grade secret management.
