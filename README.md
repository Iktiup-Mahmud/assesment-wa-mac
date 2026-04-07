# NovaPay Backend Assessment

Production-oriented multi-service backend for resilient disbursements, strict double-entry ledger, idempotent transfer APIs, FX quote locking, payroll resumability, and observability.

## Repository Layout

- [services/account-service](services/account-service)
- [services/transaction-service](services/transaction-service)
- [services/ledger-service](services/ledger-service)
- [services/fx-service](services/fx-service)
- [services/payroll-service](services/payroll-service)
- [services/admin-service](services/admin-service)
- [infra/docker-compose.yml](infra/docker-compose.yml)
- [docs/architecture.md](docs/architecture.md)
- [decisions.md](decisions.md)

## Setup

1. Clone and start stack:

- `git clone <repo>`
- `cd novapay`
- `docker compose -f infra/docker-compose.yml up -d --build`

2. Run tests (example):

- `docker compose -f infra/docker-compose.yml exec transaction-service npm test`

3. View logs:

- `docker compose -f infra/docker-compose.yml logs -f transaction-service`

4. Monitoring:

- Grafana: http://localhost:3000 (admin/admin)
- Jaeger: http://localhost:16686
- Prometheus: http://localhost:9090

## API Summary

### POST /api/transfers

Request:

```json
{
  "idempotency_key": "unique-key-123",
  "source_account_id": "uuid",
  "destination_account_id": "uuid",
  "amount": "100.0000",
  "currency": "USD"
}
```

Response:

```json
{
  "transaction_id": "uuid",
  "status": "completed",
  "ledger_entries": [
    { "entry_type": "debit", "amount": "100.0000", "currency": "USD" },
    { "entry_type": "credit", "amount": "100.0000", "currency": "USD" }
  ]
}
```

### POST /fx/quote

### GET /fx/quote/:id

### POST /api/transfers/international

## Idempotency Scenarios

- A: same key twice -> second returns stored response.
- B: many concurrent same-key requests -> one writer, others wait and replay response.
- C: crash during transfer -> atomic DB transaction prevents partial ledger state.
- D: retry after key expiry -> treated as new, with secondary duplicate mitigation.
- E: same key different payload -> `409 Conflict`.

## Double-Entry Invariant

- Meaning: for every `transaction_id`, debit sum equals credit sum.
- Verification SQL (ledger service):

```sql
SELECT transaction_id
FROM ledger_entries
GROUP BY transaction_id
HAVING SUM(CASE WHEN entry_type='debit' THEN amount ELSE 0 END)
    <> SUM(CASE WHEN entry_type='credit' THEN amount ELSE 0 END);
```

- On violation: metric `novapay_ledger_invariant_violations` > 0 + critical alert.

## FX Quote Strategy

- 60-second TTL enforced with `expires_at`.
- Single-use guaranteed with row lock + `used` flag.
- Provider outage => explicit error, no silent stale fallback.

## Payroll Resumability

- Checkpoint updates each disbursement status and counters.
- On crash, worker resumes pending disbursements.
- Exactly-once transfer effect via per-item idempotency key.

## Audit Hash Chain

- Each ledger entry stores `previous_entry_hash` and `audit_hash`.
- Tamper checks recompute hash chain.
- Mismatch can trigger account freeze workflow.

## Tradeoffs

- Simplified authn/authz and KYC hooks.
- Basic dashboards included; production alert routing not wired.
- Single-region deployment profile in compose.

## Production Readiness Gaps

- API gateway rate limiting and WAF.
- Multi-AZ DB replication + backups.
- Secret management with Vault/KMS and key rotation.
- DDoS protections.
- Immutable audit log sink.
- KYC/AML event integrations.
- Multi-region active/active rollout strategy.
# assesment-wa-mac
