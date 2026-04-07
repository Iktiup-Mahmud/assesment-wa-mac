import express, { Request, Response } from "express";
import { readFileSync } from "fs";
import SHA256 from "crypto-js/sha256";
import { Pool } from "pg";
import { Gauge, Registry } from "prom-client";
import { randomUUID } from "crypto";

const app = express();
app.use(express.json());
const port = Number(process.env.PORT ?? 3003);
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const register = new Registry();

const ledgerInvariantViolations = new Gauge({
  name: "novapay_ledger_invariant_violations",
  help: "Ledger invariant violations",
  registers: [register],
});

function computeAuditHash(payload: string, previousHash: string): string {
  return SHA256(`${previousHash}:${payload}`).toString();
}

app.post("/ledger/entries", async (req: Request, res: Response) => {
  const {
    transaction_id,
    source_account_id,
    destination_account_id,
    amount,
    currency,
    amount_debit,
    amount_credit,
    debit_currency,
    credit_currency,
    fx_quote_id,
    fx_rate,
  } = req.body as Record<string, string | number | undefined>;

  const debitAmount = String(amount_debit ?? amount ?? "0");
  const creditAmount = String(amount_credit ?? amount ?? "0");
  const debitCurrency = String(debit_currency ?? currency ?? "USD");
  const creditCurrency = String(credit_currency ?? currency ?? "USD");

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const prev = await client.query<{ audit_hash: string }>(
      "SELECT audit_hash FROM ledger_entries ORDER BY created_at DESC LIMIT 1",
    );
    const prevHash = prev.rowCount === 0 ? "GENESIS" : prev.rows[0].audit_hash;

    const debitPayload = JSON.stringify({
      transaction_id,
      source_account_id,
      entry_type: "debit",
      amount: debitAmount,
    });
    const debitHash = computeAuditHash(debitPayload, prevHash);

    const creditPayload = JSON.stringify({
      transaction_id,
      destination_account_id,
      entry_type: "credit",
      amount: creditAmount,
    });
    const creditHash = computeAuditHash(creditPayload, debitHash);

    await client.query(
      `INSERT INTO ledger_entries
      (id, transaction_id, account_id, entry_type, amount, currency, balance_after, created_at, metadata, previous_entry_hash, audit_hash)
      VALUES
      ($1,$2,$3,'debit',$4,$5,0,NOW(),$6,$7,$8),
      ($9,$2,$10,'credit',$11,$12,0,NOW(),$13,$8,$14)`,
      [
        randomUUID(),
        transaction_id,
        source_account_id,
        debitAmount,
        debitCurrency,
        JSON.stringify({ fx_quote_id, fx_rate }),
        prevHash,
        debitHash,
        randomUUID(),
        destination_account_id,
        creditAmount,
        creditCurrency,
        JSON.stringify({ fx_quote_id, fx_rate }),
        creditHash,
      ],
    );

    await client.query("COMMIT");
    return res.status(201).json({ status: "ok" });
  } catch (error) {
    await client.query("ROLLBACK");
    const message = error instanceof Error ? error.message : "UNKNOWN";
    return res.status(500).json({ error: message });
  } finally {
    client.release();
  }
});

app.get("/ledger/invariant", async (_req: Request, res: Response) => {
  const result = await db.query(
    `SELECT transaction_id
     FROM ledger_entries
     GROUP BY transaction_id
     HAVING SUM(CASE WHEN entry_type='debit' THEN amount ELSE 0 END)
        <> SUM(CASE WHEN entry_type='credit' THEN amount ELSE 0 END)`,
  );
  ledgerInvariantViolations.set(result.rowCount ?? 0);
  res.json({ violations: result.rowCount ?? 0, transactions: result.rows });
});

app.get(
  "/ledger/entries/:transactionId",
  async (req: Request, res: Response) => {
    const rows = await db.query(
      "SELECT * FROM ledger_entries WHERE transaction_id = $1 ORDER BY created_at ASC",
      [req.params.transactionId],
    );
    res.json(rows.rows);
  },
);

app.get("/metrics", async (_req: Request, res: Response) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

const ensureSchema = async (): Promise<void> => {
  const schema = readFileSync("/app/src/schema.sql", "utf8");
  const statements = schema
    .split(";")
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0);

  for (const statement of statements) {
    await db.query(`${statement};`);
  }
};

void ensureSchema()
  .then(() => {
    app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`ledger-service listening on ${port}`);
    });
  })
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("ledger-service schema init failed", error);
    process.exit(1);
  });
