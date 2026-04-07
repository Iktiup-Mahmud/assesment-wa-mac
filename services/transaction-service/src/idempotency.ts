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
  try {
    await client.query(
      `INSERT INTO idempotency_records
      (idempotency_key, request_payload_hash, status, created_at, expires_at)
      VALUES ($1, $2, 'processing', NOW(), NOW() + INTERVAL '24 hours')`,
      [key, payloadHash],
    );
    return { isNew: true };
  } catch (error) {
    const cast = error as { code?: string };
    if (cast.code !== "23505") {
      throw error;
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
