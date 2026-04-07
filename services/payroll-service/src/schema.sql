CREATE TABLE IF NOT EXISTS payroll_jobs (
  id UUID PRIMARY KEY,
  employer_account_id UUID NOT NULL,
  total_amount DECIMAL(19,4) NOT NULL,
  total_recipients INT NOT NULL,
  processed_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL CHECK (status IN ('pending','processing','completed','failed')),
  idempotency_key VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payroll_disbursements (
  id UUID PRIMARY KEY,
  payroll_job_id UUID NOT NULL,
  recipient_account_id UUID NOT NULL,
  amount DECIMAL(19,4) NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('pending','completed','failed')),
  transaction_id UUID NULL,
  error_message TEXT NULL,
  processed_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_payroll_disbursements_job ON payroll_disbursements(payroll_job_id);
