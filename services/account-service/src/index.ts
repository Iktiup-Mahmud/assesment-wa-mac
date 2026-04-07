import express, { NextFunction, Request, Response } from "express";
import { readFileSync } from "fs";
import { Pool } from "pg";
import { Counter, Histogram, Registry } from "prom-client";

const app = express();
app.use(express.json());

const port = Number(process.env.PORT ?? 3001);
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const register = new Registry();

const requestCounter = new Counter({
  name: "novapay_transactions_total",
  help: "Total number of transactions processed",
  labelNames: ["service", "status", "currency"],
  registers: [register],
});

const httpDuration = new Histogram({
  name: "novapay_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["service", "method", "route", "status"],
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5],
  registers: [register],
});

app.use((req: Request, res: Response, next: NextFunction) => {
  const end = httpDuration.startTimer();
  res.on("finish", () => {
    end({
      service: "account-service",
      method: req.method,
      route: req.path,
      status: String(res.statusCode),
    });
  });
  next();
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.get("/accounts/:id", async (req: Request, res: Response) => {
  const result = await db.query(
    "SELECT id, user_id, currency, balance, status, created_at, updated_at FROM accounts WHERE id = $1",
    [req.params.id],
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ error: "ACCOUNT_NOT_FOUND" });
  }
  requestCounter.inc({
    service: "account-service",
    status: "completed",
    currency: result.rows[0].currency,
  });
  return res.json(result.rows[0]);
});

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
      console.log(`account-service listening on ${port}`);
    });
  })
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("account-service schema init failed", error);
    process.exit(1);
  });
