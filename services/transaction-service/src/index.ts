import axios from "axios";
import express, { NextFunction, Request, Response } from "express";
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { Pool } from "pg";
import { Counter, Gauge, Histogram, Registry } from "prom-client";
import {
  completeIdempotency,
  hashPayload,
  reserveIdempotencyKey,
  waitForCompletedIdempotency,
} from "./idempotency";
import { logger, sanitizeForLogging } from "./logger";
import { TransferRequest } from "./types";

const app = express();
app.use(express.json());
const port = Number(process.env.PORT ?? 3002);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const ledgerUrl = process.env.LEDGER_SERVICE_URL ?? "http://localhost:3003";
const fxUrl = process.env.FX_SERVICE_URL ?? "http://localhost:3004";

const registry = new Registry();
const txCounter = new Counter({
  name: "novapay_transactions_total",
  help: "Total number of transactions processed",
  labelNames: ["service", "status", "currency"],
  registers: [registry],
});
const failedTxCounter = new Counter({
  name: "novapay_transactions_failed_total",
  help: "Total number of failed transactions",
  labelNames: ["service", "error_type"],
  registers: [registry],
});
const ledgerInvariantViolations = new Gauge({
  name: "novapay_ledger_invariant_violations",
  help: "Number of detected ledger invariant violations",
  registers: [registry],
});
const httpDuration = new Histogram({
  name: "novapay_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["service", "method", "route", "status"],
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10],
  registers: [registry],
});

app.use((req: Request, res: Response, next: NextFunction) => {
  const reqId =
    (req.headers["x-request-id"] as string | undefined) ?? randomUUID();
  res.setHeader("x-request-id", reqId);
  const end = httpDuration.startTimer();
  res.on("finish", () => {
    end({
      service: "transaction-service",
      method: req.method,
      route: req.path,
      status: String(res.statusCode),
    });
  });
  next();
});

app.post("/transfers", async (req: Request, res: Response) => {
  const body = req.body as TransferRequest;
  const idempotencyKey =
    (req.headers["idempotency-key"] as string | undefined) ??
    body.idempotency_key;
  if (!idempotencyKey) {
    return res.status(400).json({ error: "IDEMPOTENCY_KEY_REQUIRED" });
  }

  const payloadHash = hashPayload(body);
  const client = await pool.connect();
  let clientReleased = false;
  try {
    const reserved = await reserveIdempotencyKey(
      client,
      idempotencyKey,
      payloadHash,
    );
    client.release();
    clientReleased = true;

    if (!reserved.isNew && reserved.existingResponse) {
      if (reserved.existingResponse.status === 202) {
        const completed = await waitForCompletedIdempotency(
          pool,
          idempotencyKey,
        );
        if (completed !== null) {
          return res.status(completed.status).json(JSON.parse(completed.body));
        }
      }

      return res
        .status(reserved.existingResponse.status)
        .json(JSON.parse(reserved.existingResponse.body));
    }

    const priorTransaction = await pool.query<{
      id: string;
      amount: string;
      currency: string;
      status: string;
    }>(
      `SELECT id, amount, currency, status
       FROM transactions
       WHERE idempotency_key = $1
       LIMIT 1`,
      [idempotencyKey],
    );

    if ((priorTransaction.rowCount ?? 0) > 0) {
      const existing = priorTransaction.rows[0];
      const replayResponse = {
        transaction_id: existing.id,
        status: existing.status,
        ledger_entries: [
          {
            entry_type: "debit",
            amount: existing.amount,
            currency: existing.currency,
          },
          {
            entry_type: "credit",
            amount: existing.amount,
            currency: existing.currency,
          },
        ],
      };
      await completeIdempotency(pool, idempotencyKey, 200, replayResponse);
      return res.status(200).json(replayResponse);
    }

    const transactionId = randomUUID();
    await pool.query(
      `INSERT INTO transactions
      (id, idempotency_key, idempotency_key_hash, source_account_id, destination_account_id, amount, currency, status, created_at, updated_at, metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',NOW(),NOW(),$8)`,
      [
        transactionId,
        idempotencyKey,
        payloadHash,
        body.source_account_id,
        body.destination_account_id,
        body.amount,
        body.currency,
        JSON.stringify({ request_id: res.getHeader("x-request-id") }),
      ],
    );

    await axios.post(`${ledgerUrl}/ledger/entries`, {
      transaction_id: transactionId,
      source_account_id: body.source_account_id,
      destination_account_id: body.destination_account_id,
      amount: body.amount,
      currency: body.currency,
    });

    await pool.query(
      `UPDATE transactions SET status='completed', updated_at=NOW() WHERE id=$1`,
      [transactionId],
    );

    const responseBody = {
      transaction_id: transactionId,
      status: "completed",
      ledger_entries: [
        { entry_type: "debit", amount: body.amount, currency: body.currency },
        { entry_type: "credit", amount: body.amount, currency: body.currency },
      ],
    };

    await completeIdempotency(pool, idempotencyKey, 200, responseBody);
    txCounter.inc({
      service: "transaction-service",
      status: "completed",
      currency: body.currency,
    });
    return res.status(200).json(responseBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";

    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: string }).code ?? "")
        : "";

    if (code === "23505") {
      const priorTransaction = await pool.query<{
        id: string;
        amount: string;
        currency: string;
        status: string;
      }>(
        `SELECT id, amount, currency, status
         FROM transactions
         WHERE idempotency_key = $1
         LIMIT 1`,
        [idempotencyKey],
      );

      if ((priorTransaction.rowCount ?? 0) > 0) {
        const existing = priorTransaction.rows[0];
        const replayResponse = {
          transaction_id: existing.id,
          status: existing.status,
          ledger_entries: [
            {
              entry_type: "debit",
              amount: existing.amount,
              currency: existing.currency,
            },
            {
              entry_type: "credit",
              amount: existing.amount,
              currency: existing.currency,
            },
          ],
        };
        await completeIdempotency(pool, idempotencyKey, 200, replayResponse);
        return res.status(200).json(replayResponse);
      }
    }

    if (message === "PAYLOAD_MISMATCH") {
      return res
        .status(409)
        .json({ error: "Idempotency key already used with different payload" });
    }
    failedTxCounter.inc({
      service: "transaction-service",
      error_type: message,
    });
    logger.error(
      "transfer_failed",
      sanitizeForLogging({ error: message, body }),
    );
    return res.status(500).json({ error: message });
  } finally {
    if (!clientReleased) {
      client.release();
    }
  }
});

app.post("/transfers/international", async (req: Request, res: Response) => {
  const { quote_id, source_account_id, destination_account_id, amount } =
    req.body as {
      quote_id: string;
      source_account_id: string;
      destination_account_id: string;
      amount: string;
    };

  const transactionId = randomUUID();
  try {
    const quoteResult = await axios.post(`${fxUrl}/fx/consume`, {
      quote_id,
      transaction_id: transactionId,
    });

    const rate = Number(quoteResult.data.rate);
    const debited = Number(amount);
    const credited = (debited * rate).toFixed(4);

    await axios.post(`${ledgerUrl}/ledger/entries`, {
      transaction_id: transactionId,
      source_account_id,
      destination_account_id,
      amount_debit: debited.toFixed(4),
      amount_credit: credited,
      debit_currency: quoteResult.data.from_currency,
      credit_currency: quoteResult.data.to_currency,
      fx_quote_id: quote_id,
      fx_rate: rate,
    });

    await pool.query(
      `INSERT INTO transactions
       (id, source_account_id, destination_account_id, amount, currency, status, fx_quote_id, created_at, updated_at, metadata)
       VALUES ($1,$2,$3,$4,$5,'completed',$6,NOW(),NOW(),$7)`,
      [
        transactionId,
        source_account_id,
        destination_account_id,
        amount,
        quoteResult.data.from_currency,
        quote_id,
        JSON.stringify({}),
      ],
    );

    txCounter.inc({
      service: "transaction-service",
      status: "completed",
      currency: quoteResult.data.from_currency,
    });
    return res.json({
      transaction_id: transactionId,
      status: "completed",
      applied_rate: rate,
      debited_amount: debited.toFixed(4),
      credited_amount: credited,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "FX_PROVIDER_UNAVAILABLE";
    failedTxCounter.inc({
      service: "transaction-service",
      error_type: message,
    });
    return res.status(503).json({ error: "FX_PROVIDER_UNAVAILABLE" });
  }
});

app.get("/metrics", async (_req: Request, res: Response) => {
  res.set("Content-Type", registry.contentType);
  res.end(await registry.metrics());
});

setInterval(async () => {
  try {
    const result = await axios.get(`${ledgerUrl}/ledger/invariant`);
    const violations = Number(result.data.violations ?? 0);
    ledgerInvariantViolations.set(violations);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "INVARIANT_POLL_FAILED";
    failedTxCounter.inc({
      service: "transaction-service",
      error_type: message,
    });
  }
}, 60000);

const ensureSchema = async (): Promise<void> => {
  const schema = readFileSync("/app/src/schema.sql", "utf8");
  const statements = schema
    .split(";")
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0);

  for (const statement of statements) {
    await pool.query(`${statement};`);
  }
};

void ensureSchema()
  .then(() => {
    app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`transaction-service listening on ${port}`);
    });
  })
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("transaction-service schema init failed", error);
    process.exit(1);
  });
