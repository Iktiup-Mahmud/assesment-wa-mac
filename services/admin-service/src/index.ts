import axios from "axios";
import express, { Request, Response } from "express";
import { Pool } from "pg";

const app = express();
app.use(express.json());

const port = Number(process.env.PORT ?? 3006);
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const ledgerUrl = process.env.LEDGER_SERVICE_URL ?? "http://localhost:3003";
const transactionUrl =
  process.env.TRANSACTION_SERVICE_URL ?? "http://localhost:3002";

app.get("/admin/ledger/:transactionId", async (req: Request, res: Response) => {
  const response = await axios.get(
    `${ledgerUrl}/ledger/entries/${req.params.transactionId}`,
  );
  res.json(response.data);
});

app.get("/admin/invariant", async (_req: Request, res: Response) => {
  const response = await axios.get(`${ledgerUrl}/ledger/invariant`);
  res.json(response.data);
});

app.get("/admin/transactions/:id", async (req: Request, res: Response) => {
  const result = await db.query(
    "SELECT * FROM transaction_audit WHERE transaction_id = $1",
    [req.params.id],
  );
  res.json({ records: result.rows });
});

app.post("/admin/reverse/:id", async (req: Request, res: Response) => {
  const txId = req.params.id;
  await db.query(
    `INSERT INTO reversal_audit (id, transaction_id, reason, created_at)
     VALUES (gen_random_uuid(), $1, $2, NOW())`,
    [txId, (req.body as { reason?: string }).reason ?? "manual_reversal"],
  );

  await axios.post(
    `${transactionUrl}/transfers`,
    {
      source_account_id: (req.body as { source_account_id: string })
        .source_account_id,
      destination_account_id: (req.body as { destination_account_id: string })
        .destination_account_id,
      amount: (req.body as { amount: string }).amount,
      currency: (req.body as { currency: string }).currency,
      idempotency_key: `reversal-${txId}`,
    },
    {
      headers: {
        "idempotency-key": `reversal-${txId}`,
      },
    },
  );

  res.json({ status: "reversal_requested", transaction_id: txId });
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`admin-service listening on ${port}`);
});
