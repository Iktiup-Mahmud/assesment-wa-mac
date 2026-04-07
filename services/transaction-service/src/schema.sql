CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY,
  idempotency_key VARCHAR(255) UNIQUE,
  idempotency_key_hash VARCHAR(64),
  source_account_id UUID NOT NULL,
  destination_account_id UUID NOT NULL,
  amount DECIMAL(19,4) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  status VARCHAR(32) NOT NULL CHECK (status IN ('pending','completed','failed','reversed')),
  fx_quote_id UUID NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  idempotency_key VARCHAR(255) PRIMARY KEY,
  request_payload_hash VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('processing','completed','failed')),
  response_status INT NULL,
  response_body TEXT NULL,
  created_at TIMESTAMP NOT NULL,
  expires_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expires_at ON idempotency_records(expires_at);
