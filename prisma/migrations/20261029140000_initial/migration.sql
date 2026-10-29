CREATE SCHEMA IF NOT EXISTS "public";

CREATE TYPE "Currency" AS ENUM ('cNGN', 'cGHS', 'cXAF', 'USDx', 'EURx');
CREATE TYPE "TransactionType" AS ENUM ('DEPOSIT', 'SWAP', 'TRANSFER');
CREATE TYPE "FxSource" AS ENUM ('LIVE', 'FIXED', 'IDENTITY');

CREATE TABLE "wallets" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320),
    "mobile" VARCHAR(32),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "wallet_identifier_required" CHECK ("email" IS NOT NULL OR "mobile" IS NOT NULL)
);

CREATE TABLE "wallet_balances" (
    "wallet_id" UUID NOT NULL,
    "currency" "Currency" NOT NULL,
    "available" DECIMAL(28,8) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "wallet_balances_pkey" PRIMARY KEY ("wallet_id","currency"),
    CONSTRAINT "wallet_balance_nonnegative" CHECK ("available" >= 0)
);

CREATE TABLE "fx_snapshots" (
    "id" UUID NOT NULL,
    "source" "FxSource" NOT NULL,
    "provider" VARCHAR(128) NOT NULL,
    "ngn_per_usd" DECIMAL(36,18) NOT NULL,
    "ghs_per_usd" DECIMAL(36,18) NOT NULL,
    "xaf_per_usd" DECIMAL(36,18) NOT NULL,
    "eur_per_usd" DECIMAL(36,18) NOT NULL,
    "rate_as_of" TIMESTAMPTZ(6) NOT NULL,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "next_refresh_at" TIMESTAMPTZ(6) NOT NULL,
    "freshness" VARCHAR(32) NOT NULL,
    "last_live_snapshot_id" UUID,
    "last_live_provider" VARCHAR(128),
    "last_live_rate_as_of" TIMESTAMPTZ(6),
    CONSTRAINT "fx_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fx_snapshot_positive_rates" CHECK (
      "ngn_per_usd" > 0 AND
      "ghs_per_usd" > 0 AND
      "xaf_per_usd" > 0 AND
      "eur_per_usd" > 0
    ),
    CONSTRAINT "fx_snapshot_source" CHECK ("source" IN ('LIVE', 'FIXED'))
);

CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "type" "TransactionType" NOT NULL,
    "source_wallet_id" UUID,
    "destination_wallet_id" UUID,
    "source_currency" "Currency" NOT NULL,
    "source_amount" DECIMAL(28,8) NOT NULL,
    "destination_currency" "Currency" NOT NULL,
    "destination_amount" DECIMAL(28,8) NOT NULL,
    "applied_rate" DECIMAL(36,18),
    "rate_as_of" TIMESTAMPTZ(6),
    "fx_source" "FxSource",
    "fx_snapshot_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "transaction_positive_amounts" CHECK (
      "source_amount" > 0 AND
      "destination_amount" > 0 AND
      ("applied_rate" IS NULL OR "applied_rate" > 0)
    ),
    CONSTRAINT "transaction_type_invariants" CHECK (
      (
        "type" = 'DEPOSIT' AND
        "source_wallet_id" IS NULL AND
        "destination_wallet_id" IS NOT NULL AND
        "source_currency" = "destination_currency" AND
        "source_amount" = "destination_amount" AND
        "applied_rate" IS NULL AND
        "rate_as_of" IS NULL AND
        "fx_source" IS NULL AND
        "fx_snapshot_id" IS NULL
      ) OR (
        "type" = 'SWAP' AND
        "source_wallet_id" IS NOT NULL AND
        "source_wallet_id" = "destination_wallet_id" AND
        "source_currency" <> "destination_currency" AND
        "applied_rate" IS NOT NULL AND
        "rate_as_of" IS NOT NULL AND
        "fx_source" IN ('LIVE', 'FIXED') AND
        "fx_snapshot_id" IS NOT NULL
      ) OR (
        "type" = 'TRANSFER' AND
        "source_wallet_id" IS NOT NULL AND
        "destination_wallet_id" IS NOT NULL AND
        "source_wallet_id" <> "destination_wallet_id" AND
        "applied_rate" IS NOT NULL AND
        (
          (
            "source_currency" = "destination_currency" AND
            "applied_rate" = 1 AND
            "rate_as_of" IS NULL AND
            "fx_source" = 'IDENTITY' AND
            "fx_snapshot_id" IS NULL
          ) OR (
            "source_currency" <> "destination_currency" AND
            "rate_as_of" IS NOT NULL AND
            "fx_source" IN ('LIVE', 'FIXED') AND
            "fx_snapshot_id" IS NOT NULL
          )
        )
      )
    )
);

CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "scope" VARCHAR(96) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "transaction_id" UUID,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "idempotency_response_status" CHECK ("response_status" >= 0)
);

CREATE TABLE "swap_quotes" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "fx_snapshot_id" UUID NOT NULL,
    "source_currency" "Currency" NOT NULL,
    "destination_currency" "Currency" NOT NULL,
    "source_amount" DECIMAL(28,8) NOT NULL,
    "quoted_rate" DECIMAL(36,18) NOT NULL,
    "quoted_destination_amount" DECIMAL(28,8) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "swap_quotes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "swap_quote_currencies_differ" CHECK ("source_currency" <> "destination_currency"),
    CONSTRAINT "swap_quote_positive_values" CHECK (
      "source_amount" > 0 AND
      "quoted_rate" > 0 AND
      "quoted_destination_amount" > 0
    )
);

CREATE UNIQUE INDEX "wallets_email_key" ON "wallets"("email");
CREATE UNIQUE INDEX "wallets_mobile_key" ON "wallets"("mobile");
CREATE UNIQUE INDEX "idempotency_records_transaction_id_key" ON "idempotency_records"("transaction_id");
CREATE UNIQUE INDEX "idempotency_records_scope_key_key" ON "idempotency_records"("scope", "key");
CREATE INDEX "fx_snapshots_fetched_at_idx" ON "fx_snapshots"("fetched_at" DESC);
CREATE UNIQUE INDEX "fx_snapshots_provider_rate_as_of_source_key" ON "fx_snapshots"("provider", "rate_as_of", "source");
CREATE INDEX "swap_quotes_wallet_id_expires_at_idx" ON "swap_quotes"("wallet_id", "expires_at");

CREATE INDEX "transactions_source_wallet_cursor_idx"
  ON "transactions" ("source_wallet_id", "created_at" DESC, "id" DESC)
  WHERE "source_wallet_id" IS NOT NULL;
CREATE INDEX "transactions_destination_wallet_cursor_idx"
  ON "transactions" ("destination_wallet_id", "created_at" DESC, "id" DESC)
  WHERE "destination_wallet_id" IS NOT NULL;
CREATE INDEX "transactions_source_wallet_type_cursor_idx"
  ON "transactions" ("source_wallet_id", "type", "created_at" DESC, "id" DESC)
  WHERE "source_wallet_id" IS NOT NULL;
CREATE INDEX "transactions_destination_wallet_type_cursor_idx"
  ON "transactions" ("destination_wallet_id", "type", "created_at" DESC, "id" DESC)
  WHERE "destination_wallet_id" IS NOT NULL;
CREATE INDEX "transactions_source_wallet_currency_cursor_idx"
  ON "transactions" ("source_wallet_id", "source_currency", "created_at" DESC, "id" DESC)
  WHERE "source_wallet_id" IS NOT NULL;
CREATE INDEX "transactions_destination_wallet_currency_cursor_idx"
  ON "transactions" ("destination_wallet_id", "destination_currency", "created_at" DESC, "id" DESC)
  WHERE "destination_wallet_id" IS NOT NULL;
CREATE INDEX "transactions_deposit_amount_window_idx"
  ON "transactions" ("destination_wallet_id", "source_amount", "created_at" DESC)
  WHERE "type" = 'DEPOSIT';
CREATE INDEX "transactions_transfer_velocity_idx"
  ON "transactions" ("source_wallet_id", "created_at" DESC)
  INCLUDE ("destination_wallet_id")
  WHERE "type" = 'TRANSFER';

ALTER TABLE "wallet_balances"
  ADD CONSTRAINT "wallet_balances_wallet_id_fkey"
  FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_source_wallet_id_fkey"
  FOREIGN KEY ("source_wallet_id") REFERENCES "wallets"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_destination_wallet_id_fkey"
  FOREIGN KEY ("destination_wallet_id") REFERENCES "wallets"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_fx_snapshot_id_fkey"
  FOREIGN KEY ("fx_snapshot_id") REFERENCES "fx_snapshots"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "idempotency_records"
  ADD CONSTRAINT "idempotency_records_transaction_id_fkey"
  FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "swap_quotes"
  ADD CONSTRAINT "swap_quotes_wallet_id_fkey"
  FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "swap_quotes"
  ADD CONSTRAINT "swap_quotes_fx_snapshot_id_fkey"
  FOREIGN KEY ("fx_snapshot_id") REFERENCES "fx_snapshots"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
