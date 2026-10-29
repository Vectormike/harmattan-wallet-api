# Harmattan Wallet System Design

This document describes the complete multi-currency wallet sandbox: wallet creation, deposits, swap quotes and execution, transfers, transaction reads, FX refresh, concurrency controls, and failure handling.

## 1. System context and application layers

```mermaid
flowchart TB
  subgraph clientTrust [Trust boundary: Untrusted clients]
    Client["Client apps"]
  end

  subgraph appTrust [Trust boundary: Trusted NestJS application]
    Controllers[Controllers]
    Services[Services]
    Repositories[Repositories]

    Controllers -->|"Validated request"| Services
    Services -->|"Data command"| Repositories
  end

  subgraph databaseTrust [Trust boundary: PostgreSQL system of record]
    Postgres[PostgreSQL]
  end

  subgraph providerTrust [Trust boundary: Untrusted FX provider]
    FxProvider["FX provider"]
  end

  Client -->|"HTTP"| Controllers
  Repositories -->|"SQL"| Postgres
  Services -->|"HTTPS rates"| FxProvider
```

Domain ownership is explicit:

- `WalletModule` owns wallet lifecycle, deposits, swap quotes/execution, transfers, soft signals, and wallet-relative history through focused application services.
- `TransactionModule` owns the immutable ledger repository and single-transaction lookup. It exports `TransactionRepository` to `WalletModule`.
- The dependency is one-way (`WalletModule` → `TransactionModule`); `DatabaseModule` contains database infrastructure only, so there is no circular module dependency or globally hidden feature repository.

## 2. Deposit, quote, swap, and transfer paths

```mermaid
sequenceDiagram
  autonumber
  participant Client
  participant Ctrl as Controllers
  participant Deposit as DepositService
  participant Swap as SwapService
  participant Transfer as TransferService
  participant Quote as SwapQuoteService
  participant Fx as FxService
  participant Idem as IdempotencyService
  participant Signal as SoftSignalService
  participant Repo as TransactionRepository
  participant DB as PostgreSQL

  Note over Client,DB: Deposit
  Client->>Ctrl: POST deposit with currency, amount, Idempotency-Key
  Ctrl->>Deposit: Validated deposit command
  Deposit->>Idem: Check completed replay or conflicting body
  Idem->>DB: Read or claim unique scope and key
  Deposit->>Signal: Check same wallet and amount within one minute
  Signal->>DB: Query committed deposit operations
  Deposit->>Repo: Execute deposit unit of work
  Repo->>DB: BEGIN and SELECT FOR UPDATE one balance row
  Repo->>DB: Credit balance, insert operation, finalize idempotency
  DB-->>Repo: COMMIT all changes
  Repo-->>Deposit: Committed transaction and balance
  Deposit-->>Ctrl: Deposit result and updated balance
  Ctrl-->>Client: 201 or replayed original response

  Note over Client,DB: Swap quote
  Client->>Ctrl: POST quote with source, destination, and amount
  Ctrl->>Quote: Validated quote command
  Quote->>Fx: Resolve one coherent FX snapshot
  Fx->>DB: Read fresh snapshot or run refresh flow
  Quote->>DB: Insert immutable expiring swap quote
  DB-->>Quote: Persisted quote
  Quote-->>Ctrl: quoteId, quoted rate, destination amount, expiry
  Ctrl-->>Client: 201 quote response

  Note over Client,DB: Swap execution
  Client->>Ctrl: POST swap with quoteId and Idempotency-Key
  Ctrl->>Swap: Validated swap command
  Swap->>Idem: Check replay or claim key
  Idem->>DB: Unique claim inside transaction
  Swap->>Quote: Load quote and verify wallet, expiry, and amount cap
  Swap->>Fx: Read latest persisted execution snapshot
  Fx-->>Swap: Execution rate and snapshot metadata
  alt Rate moved over configured basis-point threshold
    Swap->>DB: ROLLBACK balances, journal, and provisional claim
    Swap-->>Ctrl: 409 FX_RATE_MOVED
    Ctrl-->>Client: Typed conflict response
  else Rate accepted
    Swap->>Repo: Execute swap unit of work
    Repo->>DB: SELECT FOR UPDATE two rows in global order
    Repo->>DB: Debit, credit, insert operation, finalize idempotency
    DB-->>Repo: COMMIT all changes
    Repo-->>Swap: Committed transaction and balances
    Swap-->>Ctrl: Swap with actual applied rate
    Ctrl-->>Client: 201 response
  end

  Note over Client,DB: Transfer
  Client->>Ctrl: POST transfer with wallets, currencies, amount, key
  Ctrl->>Transfer: Validated transfer command
  Transfer->>Idem: Check replay or claim key
  Transfer->>Signal: Count distinct recipients in velocity window
  Signal->>DB: Query committed sender transfers
  Transfer->>Fx: Resolve conversion snapshot when currencies differ
  Transfer->>Repo: Execute transfer unit of work
  Repo->>DB: SELECT FOR UPDATE sender and receiver rows in global order
  Repo->>DB: Debit, credit, insert operation, finalize idempotency
  DB-->>Repo: COMMIT all changes
  Repo-->>Transfer: Committed transaction and balances
  Transfer-->>Ctrl: Transfer result
  Ctrl-->>Client: 201 response
```

## 3. FX refresh and single-flight coordination

```mermaid
sequenceDiagram
  autonumber
  participant Caller
  participant InstanceA as API instance A
  participant InstanceB as API instance B
  participant DB as PostgreSQL
  participant Provider as ExchangeRate-API
  participant Fixed as Fixed fallback

  Caller->>InstanceA: Request rates or conversion
  InstanceA->>DB: Read latest complete snapshot
  alt Current time is before nextRefreshAt
    DB-->>InstanceA: Fresh persisted snapshot
    InstanceA-->>Caller: 25 decimal-string rates
  else Snapshot is stale
    InstanceA->>DB: Try session advisory refresh lock
    InstanceB->>DB: Try same advisory refresh lock
    DB-->>InstanceA: Leadership granted
    DB-->>InstanceB: Wait and poll for changed snapshotId
    InstanceA->>DB: Re-read snapshot after acquiring lock
    InstanceA->>Provider: HTTPS GET latest USD rates
    alt Provider succeeds with a newer timestamp
      Provider-->>InstanceA: Rates and update timestamps
      InstanceA->>InstanceA: Validate and derive all 25 pairs
      InstanceA->>DB: Append immutable live snapshot
      DB-->>InstanceB: New snapshotId becomes visible
    else Provider fails, times out, or returns 429
      InstanceA->>Fixed: Read validated fixed-rate version
      alt Fixed rates are valid
        Fixed-->>InstanceA: Fixed decimal rates and version
        InstanceA->>DB: Persist or select source fixed snapshot
      else Fixed rates are unavailable
        InstanceA-->>Caller: 503 FX_UNAVAILABLE
      end
    end
    InstanceA->>DB: Release advisory lock
    DB-->>InstanceA: Winning snapshot
    DB-->>InstanceB: Same winning snapshot
    InstanceA-->>Caller: Rates with snapshotId, rateAsOf, and source
  end
```

An incoming provider result is discarded if PostgreSQL already contains an equal or newer provider timestamp. A failed refresh never holds wallet balance locks or a money transaction.

## 4. Data model

```mermaid
erDiagram
  WALLETS ||--|{ WALLET_BALANCES : owns_exactly_five
  WALLETS ||--o{ TRANSACTIONS : source_or_destination
  WALLETS ||--o{ SWAP_QUOTES : owns
  FX_SNAPSHOTS ||--o{ SWAP_QUOTES : quotes
  FX_SNAPSHOTS ||--o{ TRANSACTIONS : prices
  TRANSACTIONS o|--o| IDEMPOTENCY_RECORDS : finalizes

  WALLETS {
    uuid id PK
    string email UK
    string mobile UK
    timestamptz created_at
  }

  WALLET_BALANCES {
    uuid wallet_id FK
    enum currency
    decimal available
    timestamptz updated_at
  }

  TRANSACTIONS {
    uuid id PK
    enum type
    uuid source_wallet_id FK
    uuid destination_wallet_id FK
    enum source_currency
    decimal source_amount
    enum destination_currency
    decimal destination_amount
    decimal applied_rate
    uuid fx_snapshot_id FK
    timestamptz created_at
  }

  IDEMPOTENCY_RECORDS {
    uuid id PK
    string scope
    string key
    string request_hash
    uuid transaction_id FK
    int response_status
    jsonb response_body
  }

  FX_SNAPSHOTS {
    uuid id PK
    enum source
    string provider
    decimal ngn_per_usd
    decimal ghs_per_usd
    decimal xaf_per_usd
    decimal eur_per_usd
    timestamptz rate_as_of
    timestamptz next_refresh_at
  }

  SWAP_QUOTES {
    uuid id PK
    uuid wallet_id FK
    uuid fx_snapshot_id FK
    enum source_currency
    enum destination_currency
    decimal source_amount
    decimal quoted_rate
    decimal quoted_destination_amount
    timestamptz expires_at
  }
```

`wallet_balances` has a unique `(wallet_id, currency)` constraint. Each wallet is created with cNGN, cGHS, cXAF, USDx, and EURx rows in one transaction. Balances are mutable projections; `transactions` is the immutable audit journal.

## 5. Failure and rollback paths

```mermaid
flowchart TD
  Request[Incoming request] -->|"Readiness check or database operation"| DatabaseAvailable{"PostgreSQL available?"}
  DatabaseAvailable -->|"No"| DatabaseError["503 DATABASE_UNAVAILABLE; no mutation"]
  DatabaseAvailable -->|"Yes"| NeedsFx{"Operation requires FX?"}
  NeedsFx -->|"No"| BeginMoney["Begin idempotent money transaction"]
  NeedsFx -->|"Yes"| ResolveFx["Read or refresh FX snapshot"]
  ResolveFx -->|"Live or fixed snapshot available"| BeginMoney
  ResolveFx -->|"Neither source valid"| FxError["503 FX_UNAVAILABLE; no mutation"]
  BeginMoney -->|"Claim unique key and lock balances"| ValidateFunds{"Validation and funds pass?"}
  ValidateFunds -->|"No"| Rollback["ROLLBACK balances, journal, and provisional claim"]
  ValidateFunds -->|"Yes"| WriteAll["Update balances, append journal, finalize idempotency"]
  WriteAll -->|"Database error or deadlock"| Rollback
  WriteAll -->|"Commit succeeds"| Commit["COMMIT one atomic result"]
  Rollback -->|"Transient conflict within retry budget"| Retry["Retry complete transaction"]
  Retry -->|"Same immutable FX snapshot"| BeginMoney
  Rollback -->|"Validation or retries exhausted"| ErrorResponse["Return typed 4xx or 5xx; no partial state"]
  Commit -->|"Response delivered"| Success["Return success"]
  Commit -->|"Process crashes before response"| SafeReplay["Retry same key and body replays stored response"]
```

## 6. Core invariants

- Amounts enter and leave the API as decimal strings; PostgreSQL stores exact `NUMERIC` values.
- A money operation either updates every required balance and appends one journal row, or changes nothing.
- All balance rows are locked in deterministic `(wallet_id, currency)` order.
- Idempotency claims participate in the same database transaction as the money mutation.
- FX refresh advisory locks never overlap wallet row locks.
- The API is stateless; PostgreSQL coordinates correctness across all instances.
- No authentication is required by the assessment. UUIDs are identifiers, not authorization; production needs identity and wallet-ownership checks.
