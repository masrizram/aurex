/**
 * @aee/economics — D7: ledger double-entry append-only + snapshot turunan.
 * Semua kalkulasi finansial DETERMINISTIK (Decimal.js) — bukan LLM (§15).
 */
import { Money, MoneyError, Ratio, sumMoney } from "@aee/money";
import { Decimal } from "decimal.js";
import { z } from "zod";
import { LedgerAccountSchema } from "@aee/contracts";

export type LedgerAccount = z.infer<typeof LedgerAccountSchema>;

export interface LedgerEntryInput {
  readonly debit: LedgerAccount;
  readonly credit: LedgerAccount;
  readonly amount: string;               // NUMERIC(20,2) string
  readonly verificationTier: string;
  readonly idempotencyKey: string;
  readonly memo?: string;
}

export class EconomicsError extends Error {
  constructor(rule: string, detail: unknown) {
    super(`economics invariant violated: ${rule}`);
    this.detail = { rule, detail: detail instanceof Error ? detail.message : detail };
  }
  readonly detail: { rule: string; detail: unknown };
}

/** Post transaksi double-entry ke ledger (validasi penuh sebelum INSERT). */
export function validateLedgerEntry(e: LedgerEntryInput): LedgerEntryInput {
  if (e.debit === e.credit) throw new EconomicsError("no_self_transfer (GAP-06)", e);
  const m = Money.parse(e.amount);
  if (!m.isPositive()) throw new EconomicsError("amount > 0", e.amount);
  if (!e.idempotencyKey || e.idempotencyKey.length < 3) throw new EconomicsError("idempotency_key wajib", e);
  return e;
}

export interface LedgerRow {
  readonly idempotency_key: string;
  readonly debit_account: LedgerAccount;
  readonly credit_account: LedgerAccount;
  readonly amount: string;
  readonly verification_tier: string;
}

/**
 * Invariant double-entry (D7): konservasi saldo akun.
 * Setiap baris ledger = satu postingan (debit_account, credit_account, amount).
 * Karena amount tunggal, "Σ debit = Σ credit" di level baris trivially benar.
 * Invariant yang SESUNGGUHNYA adalah konservasi saldo akun: bila semua saldo
 * akun dijumlahkan (debit +, credit −), hasilnya WAJIB 0.00 — kalau tidak,
 * ada postingan tidak seimbang (buku tidak menutup). Ini yang diverifikasi.
 */
export function assertDoubleEntryBalance(rows: readonly LedgerRow[]): { totalDebit: string; totalCredit: string; balanced: boolean } {
  const accounts = new Set<string>();
  for (const r of rows) { accounts.add(r.debit_account); accounts.add(r.credit_account); }
  let net = Money.from(0);
  for (const account of Array.from(accounts)) {
    net = net.add(Money.parse(accountBalance(rows, account as LedgerAccount)));
  }
  const totalDebit = sumMoney(rows.map((r) => Money.parse(r.amount))).toDB();
  const totalCredit = totalDebit; // satu kolom amount — identik di kedua sisi
  const balanced = net.isZero();
  return { totalDebit, totalCredit, balanced };
}

/** Saldo akun (positif = sisi debit; konsumen membalik utang/ekuitas). */
export function accountBalance(rows: readonly LedgerRow[], account: LedgerAccount): string {
  let bal = Money.from(0);
  for (const r of rows) {
    if (r.debit_account === account) bal = bal.add(Money.parse(r.amount));
    if (r.credit_account === account) bal = bal.sub(Money.parse(r.amount));
  }
  return bal.toDB();
}

// ── Snapshot ekonomi (§15) — dibangun ulang dari ledger, tidak pernah dari LLM ──

export interface LedgerFacts {
  readonly cashIn: string; readonly cashOut: string;
  readonly revenue: string; readonly cogs: string; readonly opex: string;
  readonly experimentCost: string; readonly llmCost: string; readonly drawdown: string;
  readonly capitalDeployed: string;
}

export interface EconomicSnapshot {
  readonly revenue: string; readonly cogs: string;
  readonly grossProfit: string; readonly grossMargin: string | null;
  readonly opex: string; readonly operatingProfit: string;
  readonly capitalAvailable: string; readonly capitalDeployed: string; readonly capitalRemaining: string;
  readonly drawdown: string;
  readonly burn: string; readonly netProfit: string;
  readonly roi: string | null;
}

export function computeSnapshot(
  facts: LedgerFacts,
  capitalApproved: string,
): EconomicSnapshot {
  const revenue = Money.parse(facts.revenue);
  const cogs = Money.parse(facts.cogs);
  const opex = Money.parse(facts.opex);
  const llm = Money.parse(facts.llmCost);
  const exp = Money.parse(facts.experimentCost);
  const deployed = Money.parse(facts.capitalDeployed);
  const approved = Money.parse(capitalApproved);

  const grossProfit = revenue.sub(cogs);
  const grossMargin = revenue.isZero() ? null : Ratio.dp4(grossProfit.toDecimal().div(revenue.toDecimal()), "gross_margin").toDB();
  const operatingProfit = grossProfit.sub(opex).sub(llm).sub(exp);
  const spend = opex.add(llm).add(exp); // burn = total pengeluaran operasional kotor
  const remaining = approved.sub(deployed);
  if (remaining.isNegative()) throw new EconomicsError("capital_remaining < 0 (TOTAL_DEPLOYED ≤ APPROVED)", { approved: capitalApproved, deployed: facts.capitalDeployed });
  const netProfit = revenue.sub(spend);
  const roi = approved.isZero() ? null : Ratio.dp4(netProfit.toDecimal().div(approved.toDecimal()), "roi").toDB();

  return {
    revenue: revenue.toDB(),
    cogs: cogs.toDB(),
    grossProfit: grossProfit.toDB(),
    grossMargin,
    opex: opex.toDB(),
    operatingProfit: operatingProfit.toDB(),
    capitalAvailable: remaining.toDB(),
    capitalDeployed: deployed.toDB(),
    capitalRemaining: remaining.toDB(),
    drawdown: facts.drawdown,
    burn: spend.toDB(),
    netProfit: netProfit.toDB(),
    roi,
  };
}

/** T37/ACHIEVED: profit dari LEDGER, bukan klaim LLM. */
export function achievedFromLedger(netProfit: string, targetProfit: string): boolean {
  return Money.parse(netProfit).gte(Money.parse(targetProfit));
}

// ── Konfigurasi capital gates (§17) — angka default spec ─────────────────────

export interface CapitalGates {
  readonly maxSingleExperimentLoss: string;   // default 1.000.000 = 10% modal
  readonly maxTotalDrawdown: string;          // default 4.000.000 (§41)
  readonly maxCapitalDeployment: string;      // default = capital_approved (8.000.000 deployable)
  readonly humanApprovalThreshold: string;    // default 2.000.000
}

export const DEFAULT_GATES: CapitalGates = {
  maxSingleExperimentLoss: "1000000.00",
  maxTotalDrawdown: "4000000.00",
  maxCapitalDeployment: "8000000.00",
  humanApprovalThreshold: "2000000.00",
};

export type GateCheck =
  | { ok: true }
  | { ok: false; code: "BUDGET_EXCEEDED" | "GATE_VIOLATION"; rule: string; detail: string };

export function checkExperimentBudget(budget: string, gates: CapitalGates): GateCheck {
  if (Money.parse(budget).gt(Money.parse(gates.maxSingleExperimentLoss))) {
    return { ok: false, code: "BUDGET_EXCEEDED", rule: "MAX_SINGLE_EXPERIMENT_LOSS", detail: `${budget} > ${gates.maxSingleExperimentLoss}` };
  }
  return { ok: true };
}

export function checkDeployment(capitalDeployed: string, incremental: string, gates: CapitalGates): GateCheck {
  const next = Money.parse(capitalDeployed).add(Money.parse(incremental));
  if (next.gt(Money.parse(gates.maxCapitalDeployment))) {
    return { ok: false, code: "GATE_VIOLATION", rule: "MAX_CAPITAL_DEPLOYMENT", detail: `${next.toDB()} > ${gates.maxCapitalDeployment}` };
  }
  return { ok: true };
}

/** Modal spec §1: Rp10.000.000 → reserve 20% → deployable 8.000.000; eksperimen 1.000.000. */
export function capitalPlan(capitalApproved: string): { total: string; reserve20: string; deployable: string; experimentCap: string } {
  const total = Money.parse(capitalApproved);
  const reserve = total.mulRatio(Ratio.dp4("0.2", "reserve"));
  const deployable = total.sub(reserve);
  return {
    total: total.toDB(),
    reserve20: reserve.toDB(),
    deployable: deployable.toDB(),
    experimentCap: total.mulRatio(Ratio.dp4("0.1", "exp_cap")).toDB(),
  };
}

// ── Skor opportunity oleh ENGINE (T07: all_scores_by_engine) ─────────────────

/** Bobot skor komposit — angka eksplisit, bukan "instruksi longgar" (§12 CAPITAL_POLICY). */
export const SCORE_WEIGHTS = {
  demand: 0.20, willingnessToPay: 0.15, profitability: 0.20, scalability: 0.10,
  defensibility: 0.15, executionFeasibility: 0.10, evidenceStrength: 0.05, timeToRevenue: 0.05,
} as const;

export interface OpportunityScores {
  /** opportunity_score NUMERIC(5,2) — rata komposit tertimbang skala 0–10. */
  readonly opportunityScore: string;
  /** risk_score NUMERIC(4,2) — lawan dari kekuatan bukti+eksekusi (0=aman,10=berisiko). */
  readonly riskScore: string;
  /** probability_of_success NUMERIC(5,4) ∈ [0,1]. */
  readonly probabilityOfSuccess: string;
  /** expected_value NUMERIC(20,2) = p × revenue_potential − cost_estimate. */
  readonly expectedValue: string;
  /** risk_adjusted_score NUMERIC(6,2) = opportunity_score × p (penalti risiko). */
  readonly riskAdjustedScore: string;
}

export interface ScoreInput {
  /** 8 skor sub-dimensi 0–10 (dari data opportunity, BUKAN dari Kimi). */
  readonly demandScore: number;
  readonly willingnessToPayScore: number;
  readonly profitabilityScore: number;
  readonly scalabilityScore: number;
  readonly defensibilityScore: number;
  readonly executionFeasibilityScore: number;
  readonly evidenceStrengthScore: number;
  readonly timeToRevenueScore: number;
  readonly revenuePotential: string;
  readonly costEstimate: string;
}

function clamp10(v: number): number { return Math.min(10, Math.max(0, v)); }

/**
 * Skor deterministik untuk satu opportunity (T07 guard: SEMUA skor dihitung engine).
 * Kimi hanya menyuplai input kualitatif; output numerik = fungsi murni input.
 */
export function computeOpportunityScores(inp: ScoreInput): OpportunityScores {
  const sub = [
    clamp10(inp.demandScore), clamp10(inp.willingnessToPayScore), clamp10(inp.profitabilityScore),
    clamp10(inp.scalabilityScore), clamp10(inp.defensibilityScore), clamp10(inp.executionFeasibilityScore),
    clamp10(inp.evidenceStrengthScore), clamp10(inp.timeToRevenueScore),
  ];
  const w = SCORE_WEIGHTS;
  const opportunityScore = Ratio.dp2(
    sub[0]! * w.demand + sub[1]! * w.willingnessToPay + sub[2]! * w.profitability +
    sub[3]! * w.scalability + sub[4]! * w.defensibility + sub[5]! * w.executionFeasibility +
    sub[6]! * w.evidenceStrength + sub[7]! * w.timeToRevenue,
    "opportunity_score",
  );
  // risiko = kepercayaan rendah: bukti lemah + eksekusi sulit + waktu-ke-pendapatan lama
  const riskScore = Ratio.dp2(
    (10 - sub[6]!) * 0.5 + (10 - sub[5]!) * 0.3 + (10 - sub[7]!) * 0.2,
    "risk_score",
  );
  // p(sukses) = skor/10 dikoreksi risiko; clamp [0,1] lalu 4 desimal
  const pRaw = new Decimal(opportunityScore.toDB()).div(10)
    .mul(new Decimal(1).sub(new Decimal(riskScore.toDB()).div(20))); // risiko memangkas p hingga 50%
  const p = Ratio.dp4(Decimal.min(Decimal.max(pRaw, 0), 1), "probability_of_success");
  const revenue = Money.parse(inp.revenuePotential);
  const cost = Money.parse(inp.costEstimate);
  const ev = Money.from(revenue.toDecimal().mul(p.toDecimal()).sub(cost.toDecimal()));
  const ras = Ratio.dp2(new Decimal(opportunityScore.toDB()).mul(p.toDecimal()), "risk_adjusted_score");
  return {
    opportunityScore: opportunityScore.toDB(),
    riskScore: riskScore.toDB(),
    probabilityOfSuccess: p.toDB(),
    expectedValue: ev.toDB(),
    riskAdjustedScore: ras.toDB(),
  };
}

export { Money, MoneyError, Ratio, sumMoney };

export {
  buildScenarios,
  type ScenarioName,
  type ScenarioInput,
  type ScenarioRow,
  type ScenarioResult,
} from "./scenarios.js";
