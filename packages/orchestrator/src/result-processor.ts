/**
 * @aee/orchestrator — Result Processor (Phase 8–9, §3.1/§10/§15).
 *
 * Tanggung jawab (spec §3.1 baris Result Processor):
 *   1. Terima GLM Result (sinkron dari dispatch ATAU async via poll)
 *      → intakeResult (kontrak §10) → tier verification.
 *   2. Tier RECONCILED via webhook pembayaran (HMAC) → SATU-SATUNYA jalur
 *      yang menulis ledger (D8: SELF_REPORTED/EVIDENCED tidak menyentuh ledger).
 *   3. Setelah ledger berubah → economic_snapshots turunan diperbarui
 *      (dihitung ulang dari ledger §15 — bukan dari klaim LLM).
 *
 * Semua fungsi dijalankan di LUAR transisi advance() — mereka menulis fakta,
 * advance() berikutnya membaca fakta itu via loadGuardContext.
 */
import type { PoolClient } from "pg";
import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import {
  type GlmResult, type ResultIntakeOutcome, determineTier, intakeResult,
} from "@aee/contracts";
import { computeSnapshot, type LedgerFacts } from "@aee/economics";
import { Money } from "@aee/money";
import { randomUUID } from "node:crypto";

// ── Intake & persist hasil eksekusi ──────────────────────────────────────────

export interface PersistOutcome {
  readonly inserted: boolean;         // false = sudah ada (idempoten)
  readonly executionId: string;
  readonly intake: ResultIntakeOutcome;
}

export interface RunningExecutionRow {
  readonly id: string;
  readonly missionId: string;         // PK DB missions.id
  readonly missionVersion: number;
  readonly packageMissionId: string;  // identitas paket (pkg.mission_id) — echo GLM
  readonly providerJobRef: string | null;
  readonly status: string;
}

/** Cari execution RUNNING milik objective (poll target). */
export async function runningExecution(
  client: PoolClient, objectiveId: string,
): Promise<RunningExecutionRow | null> {
  const { rows } = await client.query<RunningExecutionRow>(
    `SELECT e.id, e.mission_id AS "missionId", e.mission_version AS "missionVersion",
            (mv.package->>'mission_id') AS "packageMissionId",
            e.provider_job_ref AS "providerJobRef", e.status
     FROM executions e
     JOIN missions m ON m.id = e.mission_id
     JOIN mission_versions mv ON mv.mission_id = m.id AND mv.version = e.mission_version
     WHERE m.objective_id = $1 AND e.status = 'RUNNING'
     ORDER BY e.started_at DESC LIMIT 1`, [objectiveId]);
  return rows[0] ?? null;
}

/**
 * Intake + persist SATU hasil GLM (§10 aturan 1–2):
 * anti-duplikat via status≠RUNNING, anti-halusinasi referensi via identitas paket,
 * INSERT execution_results sekali (UNIQUE execution_id).
 */
export async function persistGlmResult(
  client: PoolClient,
  ex: RunningExecutionRow,
  result: GlmResult,
): Promise<PersistOutcome> {
  const intake = intakeResult({
    result,
    execution: {
      missionId: ex.packageMissionId,
      missionVersion: ex.missionVersion,
      executionId: ex.id,
      status: ex.status, // harus RUNNING — dicek intakeResult
    },
  });
  if (!intake.accepted) {
    await client.query(
      `UPDATE executions SET status = 'FAILED', finished_at = now() WHERE id = $1`, [ex.id]);
    return { inserted: false, executionId: ex.id, intake };
  }
  const payload = JSON.stringify(result);
  await client.query(
    `INSERT INTO execution_results (execution_id, payload, payload_hash, schema_valid,
       verification_tier, revenue_claimed, cost_claimed)
     VALUES ($1,$2::jsonb,$3,true,$4,$5,$6)
     ON CONFLICT (execution_id) DO NOTHING`,
    [ex.id, payload, sha256(payload), intake.verificationTier,
     result.business_metrics.revenue, result.business_metrics.cost]);
  await client.query(
    `UPDATE executions SET status = 'SUCCEEDED', finished_at = now() WHERE id = $1`, [ex.id]);
  return { inserted: true, executionId: ex.id, intake };
}

// ── Polling async (provider belum sinkron) ───────────────────────────────────

export interface PollDeps {
  /** getStatus provider — return result via registerPolledResult. */
  readonly getStatus: (ref: string) => Promise<"RUNNING" | "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "PARTIAL">;
  /** Hasil yang didapat dari poll (fetch provider nyata) — null bila masih jalan. */
  readonly fetchResult?: (ref: string) => Promise<GlmResult | null>;
}

export interface PollOutcome {
  readonly done: boolean;
  readonly persist?: PersistOutcome;
  readonly detail: string;
}

/**
 * Poll SATU execution RUNNING: provider status → fetch result → persist.
 * Tidak memanggil advance() — pemanggil (mission-manager) yang melanjutkan FSM.
 */
export async function pollExecution(
  client: PoolClient, ex: RunningExecutionRow, deps: PollDeps,
): Promise<PollOutcome> {
  if (!ex.providerJobRef) return { done: false, detail: "tanpa provider_job_ref" };
  const st = await deps.getStatus(ex.providerJobRef);
  if (st === "FAILED" || st === "TIMED_OUT") {
    await client.query(
      `UPDATE executions SET status = $2, finished_at = now() WHERE id = $1`, [ex.id, st]);
    return { done: true, detail: `provider ${st} — execution ditandai ${st}` };
  }
  if (st !== "SUCCEEDED" && st !== "PARTIAL") {
    return { done: false, detail: `provider ${st} — masih berjalan` };
  }
  if (!deps.fetchResult) return { done: false, detail: "fetchResult tak tersedia (provider sinkron)" };
  const result = await deps.fetchResult(ex.providerJobRef);
  if (!result) return { done: false, detail: "result belum tersedia" };
  const persist = await persistGlmResult(client, ex, result);
  return { done: true, persist, detail: `polled → tier ${persist.intake.accepted ? persist.intake.verificationTier : "REJECTED"}` };
}

// ── Webhook pembayaran → RECONCILED → ledger (satu-satunya jalur nilai) ─────

export interface WebhookPayload {
  /** external_id provider = idempotency_key execution (pkg.mission_id:version:attempt). */
  readonly external_id: string;
  readonly amount: string;            // "123456.78"
  readonly kind: "REVENUE" | "COST";
  readonly provider: string;          // xendit | midtrans | manual
  readonly occurred_at?: string;      // ISO
}

export interface ReconcileOutcome {
  readonly ok: boolean;
  readonly code?:
    | "SIGNATURE_INVALID" | "EXECUTION_NOT_FOUND" | "ALREADY_RECONCILED"
    | "AMOUNT_MISMATCH" | "LEDGER_WRITTEN";
  readonly detail: string;
  readonly ledgerId?: string;
}

function verifyHmac(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface ReconcileRow {
  readonly executionId: string;
  readonly objectiveId: string;
  readonly cycleId: string | null;
  readonly revenueClaimed: string;
  readonly costClaimed: string;
  readonly verificationTier: string | null;
}

/**
 * Proses webhook pembayaran (§8 POST /webhooks/payments/:provider):
 * 1. verifikasi HMAC (timing-safe),
 * 2. temukan execution via external_id == idempotency_key,
 * 3. tolak duplikat (idempotency ledger `webhook:{external_id}:{kind}`),
 * 4. naikkan tier → RECONCILED,
 * 5. INSERT capital_transactions double-entry + refresh snapshot turunan.
 */
export async function processPaymentWebhook(
  client: PoolClient,
  payload: WebhookPayload,
  rawBody: string,
  signature: string,
  secret: string,
): Promise<ReconcileOutcome> {
  if (!verifyHmac(rawBody, signature, secret)) {
    return { ok: false, code: "SIGNATURE_INVALID", detail: "HMAC tidak cocok" };
  }
  // execution via idempotency_key (external_id) + mission objective
  const { rows } = await client.query<ReconcileRow>(
    `SELECT e.id AS "executionId", m.objective_id AS "objectiveId", e.cycle_id AS "cycleId",
            COALESCE(er.revenue_claimed, 0)::text AS "revenueClaimed",
            COALESCE(er.cost_claimed, 0)::text AS "costClaimed",
            er.verification_tier AS "verificationTier"
     FROM executions e
     JOIN missions m ON m.id = e.mission_id
     LEFT JOIN execution_results er ON er.execution_id = e.id
     WHERE e.idempotency_key = $1
     ORDER BY e.started_at DESC LIMIT 1`, [payload.external_id]);
  const row = rows[0];
  if (!row) {
    return { ok: false, code: "EXECUTION_NOT_FOUND", detail: `external_id ${payload.external_id} tidak dikenal` };
  }
  // Idempoten webhook: kunci unik ledger
  const idem = `webhook:${payload.external_id}:${payload.kind}`;
  const dup = await client.query(`SELECT id FROM capital_transactions WHERE idempotency_key = $1`, [idem]);
  if ((dup.rowCount ?? 0) > 0) {
    return { ok: true, code: "ALREADY_RECONCILED", detail: `webhook ${idem} sudah diproses (idempoten)` };
  }
  // Validasi amount vs klaim (revenue webhook ≤ revenue_claimed; cost idem)
  const claimed = payload.kind === "REVENUE" ? row.revenueClaimed : row.costClaimed;
  if (Money.parse(payload.amount).gt(Money.parse(claimed))) {
    return {
      ok: false, code: "AMOUNT_MISMATCH",
      detail: `amount ${payload.amount} > claimed ${claimed} (${payload.kind})`,
    };
  }
  // Naikkan tier hasil → RECONCILED (bukti pembayaran = rekonsiliasi)
  await client.query(
    `UPDATE execution_results SET verification_tier = 'RECONCILED'
     WHERE execution_id = $1 AND verification_tier IN ('SELF_REPORTED','EVIDENCED')`,
    [row.executionId]);

  // Double-entry (§15): REVENUE → debit CASH credit REVENUE; COST → debit COGS credit CASH
  const [debit, credit] = payload.kind === "REVENUE"
    ? (["CASH", "REVENUE"] as const)
    : (["COGS", "CASH"] as const);
  const ins = await client.query<{ id: string }>(
    `INSERT INTO capital_transactions (objective_id, cycle_id, execution_id, idempotency_key,
       debit_account, credit_account, amount, verification_tier, memo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'RECONCILED',$8) RETURNING id`,
    [row.objectiveId, row.cycleId, row.executionId, idem, debit, credit,
     payload.amount, `webhook ${payload.provider} ${payload.occurred_at ?? ""}`.trim()]);
  await refreshSnapshot(client, row.objectiveId, row.cycleId);
  return {
    ok: true, code: "LEDGER_WRITTEN",
    detail: `${payload.kind} ${payload.amount} RECONCILED → ledger (tier naik)`,
    ledgerId: ins.rows[0]?.id,
  };
}

// ── Snapshot turunan (§15 — dibangun ulang dari ledger) ──────────────────────

export async function ledgerFacts(
  client: PoolClient, objectiveId: string,
): Promise<LedgerFacts> {
  const { rows } = await client.query<{
    cash_in: string; cash_out: string; revenue: string; cogs: string; opex: string;
    experiment_cost: string; llm_cost: string; drawdown: string; capital_deployed: string;
  }>(
    `SELECT
       COALESCE(sum(amount) FILTER (WHERE debit_account='CASH'), 0)::text AS cash_in,
       COALESCE(sum(amount) FILTER (WHERE credit_account='CASH'), 0)::text AS cash_out,
       COALESCE(sum(amount) FILTER (WHERE credit_account='REVENUE'), 0)::text AS revenue,
       COALESCE(sum(amount) FILTER (WHERE debit_account='COGS'), 0)::text AS cogs,
       COALESCE(sum(amount) FILTER (WHERE debit_account='OPEX'), 0)::text AS opex,
       COALESCE(sum(amount) FILTER (WHERE debit_account='EXPERIMENT_COST'), 0)::text AS experiment_cost,
       COALESCE(sum(amount) FILTER (WHERE debit_account='LLM_COST'), 0)::text AS llm_cost,
       COALESCE(sum(amount) FILTER (WHERE debit_account='DRAWDOWN'), 0)::text AS drawdown,
       COALESCE(sum(amount) FILTER (WHERE debit_account='CAPITAL_DEPLOYED'), 0)::text AS capital_deployed
     FROM capital_transactions WHERE objective_id = $1`, [objectiveId]);
  const r = rows[0]!;
  return {
    cashIn: r.cash_in, cashOut: r.cash_out, revenue: r.revenue, cogs: r.cogs,
    opex: r.opex, experimentCost: r.experiment_cost, llmCost: r.llm_cost,
    drawdown: r.drawdown, capitalDeployed: r.capital_deployed,
  };
}

/** Tulis snapshot ekonomi TURUNAN dari ledger (dipanggil setelah perubahan ledger). */
export async function refreshSnapshot(
  client: PoolClient, objectiveId: string, cycleId: string | null,
): Promise<void> {
  const facts = await ledgerFacts(client, objectiveId);
  const obj = await client.query<{ capital_approved: string }>(
    `SELECT capital_approved::text FROM objectives WHERE id = $1`, [objectiveId]);
  const approved = obj.rows[0]?.capital_approved ?? "0.00";
  const snap = computeSnapshot(facts, approved);
  const evt = await client.query<{ id: string }>(
    `SELECT id FROM events WHERE objective_id = $1 ORDER BY created_at DESC LIMIT 1`, [objectiveId]);
  await client.query(
    `INSERT INTO economic_snapshots (objective_id, cycle_id, revenue, cogs, gross_profit,
       gross_margin, opex, operating_profit, capital_available, capital_deployed,
       capital_remaining, drawdown, source_event_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [objectiveId, cycleId, snap.revenue, snap.cogs, snap.grossProfit,
     snap.grossMargin, snap.opex, snap.operatingProfit, snap.capitalAvailable,
     snap.capitalDeployed, snap.capitalRemaining, snap.drawdown,
     evt.rows[0]?.id ?? randomUUID()]);
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
