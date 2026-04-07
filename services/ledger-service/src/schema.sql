CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY,
  transaction_id UUID NOT NULL,
  account_id UUID NOT NULL,
  entry_type VARCHAR(16) NOT NULL CHECK (entry_type IN ('debit','credit')),
  amount DECIMAL(19,4) NOT NULL CHECK (amount > 0),
  currency VARCHAR(3) NOT NULL,
  balance_after DECIMAL(19,4) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  audit_hash VARCHAR(64) NOT NULL,
  previous_entry_hash VARCHAR(64) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_transaction_id ON ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_ledger_account_id ON ledger_entries(account_id);
CREATE INDEX IF NOT EXISTS idx_ledger_created_at ON ledger_entries(created_at);
