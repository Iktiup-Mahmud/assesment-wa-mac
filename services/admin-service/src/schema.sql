CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS transaction_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reversal_audit (
  id UUID PRIMARY KEY,
  transaction_id UUID NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL
);
