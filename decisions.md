# Architecture Decisions

## 1. Idempotency Implementation

### Scenario A: Same Key Twice

- Mechanism: PostgreSQL unique constraint on `idempotency_records.idempotency_key`.
- Handling: First request processes, subsequent request returns stored response.
- Guarantee: no duplicate debit.

### Scenario B: Concurrent Identical Requests

- Isolation: `SERIALIZABLE` transaction for idempotency reservation.
- Only one insert succeeds; other requests see existing record.
- If status is `processing`, losers poll with bounded wait until response is available.
- All callers receive byte-identical response body.

### Scenario C: Crash After Debit

- Ledger writes are a single DB transaction (two entries persisted together).
- If process crashes before commit, both entries roll back.
- Recovery job scans pending old transfers and sets failed/retry state; no orphan debit is allowed.

### Scenario D: Expired Key Retry

- Idempotency record expires after 24h and can be cleaned.
- Retry after expiry is treated as new request.
- Risk: duplicate external intent.
- Mitigation: secondary dedupe check on recent transactions `(source_account_id, destination_account_id, amount, currency, created_at window)`.

### Scenario E: Payload Mismatch

- Request payload hash (`sha256`) is persisted with key.
- Same key + different payload returns `409 Conflict`.
- Client must supply a fresh key for changed payload.

## 2. Bulk Payroll Concurrency

### Why BullMQ Grouped Concurrency Instead of DB Locks

- Row locks serialize all workers and create lock queues under heavy payroll fanout.
- BullMQ processes one active payroll stream per employer while still parallelizing across employers.
- Observability improves via queue depth, retries, dead-letter counts, and processing latency metrics.
- Result: lower DB contention and predictable throughput.

## 3. FX Rate Staleness Prevention

### Enforcement

- Quote schema includes `expires_at`, `used`, `used_by_transaction_id`.
- Consumption path runs under `FOR UPDATE` lock.
- Reject when quote is expired or already used.
- No fallback to stale quote cache.

### Provider Failure

- If upstream FX provider fails, return `FX_PROVIDER_UNAVAILABLE`.
- Transaction service aborts before ledger write.
- No partial financial state is created.

## 4. Double-Entry + Ledger Invariant

- Ledger service is source of truth for money movement.
- Each transaction writes exactly one debit and one credit entry in one DB transaction.
- Periodic invariant query checks `SUM(debits)=SUM(credits)` grouped by transaction.
- Any violation sets critical metric and alerts incident channel.

## 5. Security Tradeoff

- Envelope encryption implemented at field level using KEK/DEK hierarchy.
- This baseline uses env-based KEK for assessment speed.
- Production must move KEK management to KMS/Vault + rotation + access policy.
