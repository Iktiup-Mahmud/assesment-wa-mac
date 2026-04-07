import axios from "axios";
import express, { Request, Response } from "express";
import { randomUUID } from "crypto";
import { Pool } from "pg";

const app = express();
app.use(express.json());

const port = Number(process.env.PORT ?? 3004);
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const providerUrl =
  process.env.FX_PROVIDER_URL ?? "http://localhost:4010/rates";

app.post("/fx/quote", async (req: Request, res: Response) => {
  const { from_currency, to_currency } = req.body as {
    from_currency: string;
    to_currency: string;
  };
  try {
    const providerResponse = await axios.get(providerUrl, { timeout: 1500 });
    const rateValue = Number((providerResponse.data as { rate: number }).rate);

    if (!Number.isFinite(rateValue) || rateValue <= 0) {
      return res.status(503).json({ error: "FX_PROVIDER_UNAVAILABLE" });
    }

    const id = randomUUID();
    const result = await db.query(
      `INSERT INTO fx_quotes
      (id, from_currency, to_currency, rate, created_at, expires_at, used)
      VALUES ($1,$2,$3,$4,NOW(),NOW() + INTERVAL '60 seconds',false)
      RETURNING id, from_currency, to_currency, rate, created_at, expires_at, used`,
      [id, from_currency, to_currency, rateValue],
    );

    const quote = result.rows[0];
    return res.status(201).json({
      quote_id: quote.id,
      rate: quote.rate,
      expires_at: quote.expires_at,
      ttl_seconds: 60,
    });
  } catch (_error) {
    return res.status(503).json({ error: "FX_PROVIDER_UNAVAILABLE" });
  }
});

app.get("/fx/quote/:id", async (req: Request, res: Response) => {
  const result = await db.query("SELECT * FROM fx_quotes WHERE id = $1", [
    req.params.id,
  ]);
  if (result.rowCount === 0) {
    return res.status(404).json({ error: "QUOTE_NOT_FOUND" });
  }

  const quote = result.rows[0] as {
    id: string;
    rate: string;
    expires_at: string;
    used: boolean;
  };
  const remainingMs = Math.max(
    new Date(quote.expires_at).getTime() - Date.now(),
    0,
  );

  return res.json({
    quote_id: quote.id,
    rate: quote.rate,
    expires_at: quote.expires_at,
    remaining_seconds: Math.floor(remainingMs / 1000),
    used: quote.used,
  });
});

app.post("/fx/consume", async (req: Request, res: Response) => {
  const { quote_id, transaction_id } = req.body as {
    quote_id: string;
    transaction_id: string;
  };
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const quoteResult = await client.query(
      "SELECT * FROM fx_quotes WHERE id = $1 FOR UPDATE",
      [quote_id],
    );

    if (quoteResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "QUOTE_NOT_FOUND" });
    }

    const quote = quoteResult.rows[0] as {
      used: boolean;
      expires_at: string;
      from_currency: string;
      to_currency: string;
      rate: string;
    };

    if (quote.used) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "QUOTE_ALREADY_USED" });
    }

    if (new Date(quote.expires_at).getTime() <= Date.now()) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "QUOTE_EXPIRED" });
    }

    await client.query(
      `UPDATE fx_quotes
       SET used=true, used_at=NOW(), used_by_transaction_id=$2
       WHERE id=$1`,
      [quote_id, transaction_id],
    );
    await client.query("COMMIT");

    return res.json({
      quote_id,
      from_currency: quote.from_currency,
      to_currency: quote.to_currency,
      rate: quote.rate,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    const message = error instanceof Error ? error.message : "UNKNOWN";
    return res.status(500).json({ error: message });
  } finally {
    client.release();
  }
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`fx-service listening on ${port}`);
});
