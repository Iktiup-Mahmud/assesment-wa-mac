# Transaction Service

Responsibilities:

- Transfer orchestration
- Idempotency handling
- International transfer orchestration with FX quote consumption

## Endpoints

- `POST /transfers`
- `POST /transfers/international`
- `GET /metrics`

## Notes

- Uses DB-level idempotency uniqueness (`idempotency_records.idempotency_key`).
- Uses serializable transaction when reserving idempotency key.
