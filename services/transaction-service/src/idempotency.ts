import { createHash } from "crypto";
import { Pool, PoolClient } from "pg";
import { IdempotencyRecord } from "./types";

export interface ReserveResult {
  isNew: boolean;
  existingResponse?: { status: number; body: string };
}

export function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function reserveIdempotencyKey(
  client: PoolClient,
  key: string,
  payloadHash: string,
): Promise<ReserveResult> {
  const insertResult = await client.query<{ inserted: boolean }>(
    `WITH ins AS (
       INSERT INTO idempotency_records
         (idempotency_key, request_payload_hash, status, created_at, expires_at)
       VALUES ($1, $2, 'processing', NOW(), NOW() + INTERVAL '24 hours')
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING idempotency_key
     )
     SELECT EXISTS(SELECT 1 FROM ins) AS inserted`,
    [key, payloadHash],
  );

  if (insertResult.rows[0]?.inserted === true) {
    return { isNew: true };
  }

  const existing = await client.query<IdempotencyRecord>(
    `SELECT idempotency_key, request_payload_hash, response_status, response_body, status
     FROM idempotency_records
     WHERE idempotency_key = $1`,
    [key],
  );

  if (existing.rowCount === 0) {
    throw new Error("IDEMPOTENCY_LOOKUP_FAILED");
  }

  const row = existing.rows[0];
  if (row.request_payload_hash !== payloadHash) {
    throw new Error("PAYLOAD_MISMATCH");
  }

  if (
    row.status !== "completed" ||
    row.response_body === null ||
    row.response_status === null
  ) {
    return {
      isNew: false,
      existingResponse: {
        status: 202,
        body: JSON.stringify({ status: "processing" }),
      },
    };
  }

  return {
    isNew: false,
    existingResponse: {
      status: row.response_status,
      body: row.response_body,
    },
  };
}

export async function waitForCompletedIdempotency(
  pool: Pool,
  key: string,
  timeoutMs = 3000,
): Promise<{ status: number; body: string } | null> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const row = await pool.query<IdempotencyRecord>(
      `SELECT idempotency_key, request_payload_hash, response_status, response_body, status
       FROM idempotency_records WHERE idempotency_key = $1`,
      [key],
    );

    if ((row.rowCount ?? 0) > 0) {
      const record = row.rows[0];
      if (
        record.status === "completed" &&
        record.response_status !== null &&
        record.response_body !== null
      ) {
        return { status: record.response_status, body: record.response_body };
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return null;
}

export async function completeIdempotency(
  pool: Pool,
  key: string,
  statusCode: number,
  body: unknown,
): Promise<void> {
  await pool.query(
    `UPDATE idempotency_records
     SET status = 'completed', response_status = $2, response_body = $3
     WHERE idempotency_key = $1`,
    [key, statusCode, JSON.stringify(body)],
  );
}
