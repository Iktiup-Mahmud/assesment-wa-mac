export type TransferStatus = "pending" | "completed" | "failed" | "reversed";

export interface TransferRequest {
  source_account_id: string;
  destination_account_id: string;
  amount: string;
  currency: string;
  idempotency_key: string;
}

export interface IdempotencyRecord {
  idempotency_key: string;
  request_payload_hash: string;
  response_status: number | null;
  response_body: string | null;
  status: "processing" | "completed" | "failed";
}
