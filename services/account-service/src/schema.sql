CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  currency VARCHAR(3) NOT NULL,
  balance DECIMAL(19,4) NOT NULL CHECK (balance >= 0),
  status VARCHAR(16) NOT NULL CHECK (status IN ('active','frozen','closed')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, currency)
);
CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);
