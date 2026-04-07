# NovaPay Backend Architecture

```mermaid
flowchart LR
  C[Client Apps] --> G[API Gateway\nNginx]

  subgraph Core Services
    A[Account Service]
    T[Transaction Service]
    L[Ledger Service]
    F[FX Service]
    P[Payroll Service]
    AD[Admin Service]
  end

  G --> A
  G --> T
  G --> F
  G --> P
  G --> AD

  T -->|REST: validate account| A
  T -->|REST: post double-entry| L
  T -->|REST: consume quote| F
  P -->|REST: initiate transfer| T
  AD -->|REST read-only| L
  AD -->|REST status| T

  P -->|BullMQ jobs| R[(Redis)]
  R --> P

  subgraph Datastores (No Shared DB)
    DBA[(Postgres\naccount-db)]
    DBT[(Postgres\ntransaction-db)]
    DBL[(Postgres\nledger-db)]
    DBF[(Postgres\nfx-db)]
    DBP[(Postgres\npayroll-db)]
    DBAD[(Postgres\nadmin-db)]
  end

  A --> DBA
  T --> DBT
  L --> DBL
  F --> DBF
  P --> DBP
  AD --> DBAD

  subgraph External Systems
    FXP[External FX Provider]
    PROM[Prometheus]
    GRAF[Grafana]
    JAE[Jaeger]
  end

  F --> FXP
  A --> PROM
  T --> PROM
  L --> PROM
  F --> PROM
  P --> PROM
  AD --> PROM
  PROM --> GRAF

  A --> JAE
  T --> JAE
  L --> JAE
  F --> JAE
  P --> JAE
  AD --> JAE
```

## Data Flows

### 1) Single Transfer

1. Client calls API Gateway `POST /api/transfers` with `idempotency-key`.
2. Transaction Service inserts into `idempotency_records` (DB unique constraint).
3. Transaction Service validates accounts with Account Service.
4. Transaction Service writes transfer intent and calls Ledger Service.
5. Ledger Service writes exactly two rows (`debit`, `credit`) in one DB transaction.
6. Transaction Service marks transfer completed and stores idempotent response.

### 2) Bulk Payroll

1. Client calls Payroll endpoint with payroll file/list.
2. Payroll Service stores `payroll_jobs` + `payroll_disbursements`.
3. Payroll Service enqueues BullMQ job (grouped per employer).
4. Worker processes disbursements with per-disbursement idempotency key.
5. Progress counters updated after each checkpoint.

### 3) International Transfer

1. Client gets quote from FX Service (`POST /fx/quote`).
2. FX Service stores locked quote with 60s TTL.
3. Client initiates `POST /api/transfers/international` with `quote_id`.
4. Transaction Service calls FX Service to consume quote (row lock + expiry check).
5. Transaction Service posts converted double-entry to Ledger Service.
6. If quote expired/unavailable, transfer is rejected and no ledger entries are created.
