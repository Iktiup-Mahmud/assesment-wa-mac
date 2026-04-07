import axios from "axios";
import { Job, Queue, Worker } from "bullmq";
import express, { Request, Response } from "express";
import IORedis from "ioredis";
import { randomUUID } from "crypto";
import { Pool } from "pg";

const app = express();
app.use(express.json());

const port = Number(process.env.PORT ?? 3005);
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new IORedis({
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? "6379"),
  maxRetriesPerRequest: null,
});

const queue = new Queue("payroll-processing", { connection: redis });
const txServiceUrl =
  process.env.TRANSACTION_SERVICE_URL ?? "http://localhost:3002";

app.post("/payroll/jobs", async (req: Request, res: Response) => {
  const { employer_account_id, disbursements, idempotency_key } = req.body as {
    employer_account_id: string;
    disbursements: Array<{ recipient_account_id: string; amount: string }>;
    idempotency_key: string;
  };

  const total = disbursements.reduce((sum, d) => sum + Number(d.amount), 0);
  const jobId = randomUUID();

  await db.query(
    `INSERT INTO payroll_jobs
    (id, employer_account_id, total_amount, total_recipients, status, idempotency_key, processed_count, failed_count, created_at, updated_at)
    VALUES ($1,$2,$3,$4,'pending',$5,0,0,NOW(),NOW())`,
    [
      jobId,
      employer_account_id,
      total.toFixed(4),
      disbursements.length,
      idempotency_key,
    ],
  );

  for (const d of disbursements) {
    await db.query(
      `INSERT INTO payroll_disbursements
      (id, payroll_job_id, recipient_account_id, amount, status)
      VALUES ($1,$2,$3,$4,'pending')`,
      [randomUUID(), jobId, d.recipient_account_id, d.amount],
    );
  }

  await queue.add(
    "process-payroll",
    { jobId, employer: employer_account_id },
    { jobId: `payroll-${jobId}` },
  );

  return res.status(202).json({ payroll_job_id: jobId, status: "pending" });
});

new Worker(
  "payroll-processing",
  async (job: Job<{ jobId: string; employer: string }>) => {
    const { jobId } = job.data as { jobId: string };
    const jobRow = await db.query(
      "SELECT id, employer_account_id FROM payroll_jobs WHERE id=$1",
      [jobId],
    );
    if (jobRow.rowCount === 0) {
      throw new Error("PAYROLL_JOB_NOT_FOUND");
    }

    await db.query(
      `UPDATE payroll_jobs SET status='processing', updated_at=NOW() WHERE id=$1`,
      [jobId],
    );

    const pending = await db.query(
      `SELECT id, recipient_account_id, amount
       FROM payroll_disbursements
       WHERE payroll_job_id=$1 AND status='pending'
       ORDER BY id ASC`,
      [jobId],
    );

    for (const row of pending.rows as Array<{
      id: string;
      recipient_account_id: string;
      amount: string;
    }>) {
      try {
        const idem = `payroll-${jobId}-${row.id}`;
        const response = await axios.post(
          `${txServiceUrl}/transfers`,
          {
            source_account_id: jobRow.rows[0].employer_account_id,
            destination_account_id: row.recipient_account_id,
            amount: row.amount,
            currency: "USD",
            idempotency_key: idem,
          },
          { headers: { "idempotency-key": idem } },
        );

        await db.query(
          `UPDATE payroll_disbursements
           SET status='completed', transaction_id=$2, processed_at=NOW()
           WHERE id=$1`,
          [row.id, response.data.transaction_id],
        );
        await db.query(
          "UPDATE payroll_jobs SET processed_count = processed_count + 1, updated_at=NOW() WHERE id=$1",
          [jobId],
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "UNKNOWN";
        await db.query(
          `UPDATE payroll_disbursements
           SET status='failed', error_message=$2
           WHERE id=$1`,
          [row.id, message],
        );
        await db.query(
          "UPDATE payroll_jobs SET failed_count = failed_count + 1, updated_at=NOW() WHERE id=$1",
          [jobId],
        );
      }
    }

    await db.query(
      `UPDATE payroll_jobs SET status='completed', updated_at=NOW() WHERE id=$1`,
      [jobId],
    );
  },
  {
    connection: redis,
    concurrency: 10,
    limiter: {
      max: 1,
      duration: 1000,
    },
  },
);

app.get("/payroll/jobs/:id", async (req: Request, res: Response) => {
  const job = await db.query("SELECT * FROM payroll_jobs WHERE id=$1", [
    req.params.id,
  ]);
  if (job.rowCount === 0) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }
  return res.json(job.rows[0]);
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`payroll-service listening on ${port}`);
});
