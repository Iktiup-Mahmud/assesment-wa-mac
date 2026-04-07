CREATE TABLE IF NOT EXISTS fx_quotes (
  id UUID PRIMARY KEY,
  from_currency VARCHAR(3) NOT NULL,
  to_currency VARCHAR(3) NOT NULL,
  rate DECIMAL(19,8) NOT NULL,
  created_at TIMESTAMP NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  used_at TIMESTAMP NULL,
  used_by_transaction_id UUID NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS idx_fx_quotes_expiry_used ON fx_quotes(expires_at, used);
