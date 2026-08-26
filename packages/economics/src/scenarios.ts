/**
 * D-Scenario (§15 master prompt): proyeksi BEAR/BASE/BULL DETERMINISTIK
 * dari snapshot ekonomi NYATA — bukan angka karangan (Rule 4).
 *
 * Model linear transparan (asumsi dideklarasikan, bukan disembunyikan):
 *   - Δ revenue bulanan tetap per skenario: BEAR −30%, BASE ±0%, BULL +25%.
 *   - Profit bulanan diskalakan proporsional dengan Δ revenue
 *     (margin konstan — asumsi eksplisit; sensitivitas margin menyusul
 *      begitu domain punya breakdown COGS/opex per snapshot).
 *   - Probabilitas tetap: 0.30 / 0.45 / 0.25 (prior netral; belum ada
 *     frekuensi historis lintas-objective untuk mengestimasi ulang).
 *   - EV = Σ pᵢ · (profitBulananᵢ × horizon).
 *   - Payback = ⌈capital_remaining ÷ profit BASE⌉ (null bila profit ≤ 0).
 *
 * Semua keluaran adalah PROYEKSI (PROJECTED) dan harus ditampilkan
 * UI dengan label value-state tersebut — tidak boleh dicampur verified.
 */
import { Decimal } from "decimal.js";
import { Money, Ratio } from "@aee/money";

export type ScenarioName = "BEAR" | "BASE" | "BULL";

export interface ScenarioInput {
  /** Revenue bulanan terakhir dari economic_snapshots (wajib ≥ 0). */
  readonly monthlyRevenue: string;
  /** Operating profit bulanan terakhir (boleh negatif). */
  readonly monthlyOperatingProfit: string;
  /** Capital remaining (modal dialokasikan yang belum habis). */
  readonly capitalRemaining: string;
  /** Horizon proyeksi bulan (default 3, clamp 1–12). */
  readonly horizonMonths?: number;
}

export interface ScenarioRow {
  readonly name: ScenarioName;
  /** Δ revenue bulanan (NUMERIC(8,4)): −0.3000 / 0.0000 / 0.2500. */
  readonly revenueDelta: string;
  readonly projectedMonthlyRevenue: string;
  readonly projectedMonthlyProfit: string;
  /** Total profit selama horizon utk skenario ini (profit × horizon). */
  readonly projectedTotalProfit: string;
  readonly probability: string;
}

export interface ScenarioResult {
  readonly horizonMonths: number;
  readonly scenarios: readonly ScenarioRow[];
  /** Σ pᵢ · totalProfitᵢ — NUMERIC(20,2), bisa negatif. */
  readonly probabilityWeightedEV: string;
  /** ⌈capital_remaining ÷ profit BASE bulanan⌉; null bila profit BASE ≤ 0. */
  readonly paybackMonths: number | null;
}

const DELTAS: ReadonlyArray<{ name: ScenarioName; delta: string; p: string }> = [
  { name: "BEAR", delta: "-0.30", p: "0.30" },
  { name: "BASE", delta: "0", p: "0.45" },
  { name: "BULL", delta: "0.25", p: "0.25" },
];

/** Bangun skenario dari snapshot nyata. Deterministik penuh (Decimal.js). */
export function buildScenarios(inp: ScenarioInput): ScenarioResult {
  const revenue = Money.parse(inp.monthlyRevenue);
  if (!revenue.gte(Money.from("0"))) throw new Error("monthlyRevenue >= 0 wajib");
  const profit = Money.parse(inp.monthlyOperatingProfit);
  const capital = Money.parse(inp.capitalRemaining);
  if (!capital.gte(Money.from("0"))) throw new Error("capitalRemaining >= 0 wajib");
  const horizon = Math.min(12, Math.max(1, Math.floor(inp.horizonMonths ?? 3)));

  const rows = DELTAS.map(({ name, delta, p }) => {
    const d = new Decimal(delta);
    const factor = new Decimal(1).plus(d);
    const projRevenue = Money.from(revenue.toDecimal().mul(factor));
    const projProfit = Money.from(profit.toDecimal().mul(factor));
    const total = Money.from(projProfit.toDecimal().mul(horizon));
    return {
      name,
      revenueDelta: Ratio.dp4(new Decimal(delta), "revenue_delta").toDB(),
      projectedMonthlyRevenue: projRevenue.toDB(),
      projectedMonthlyProfit: projProfit.toDB(),
      projectedTotalProfit: total.toDB(),
      probability: Ratio.dp4(new Decimal(p), "scenario_probability").toDB(),
    };
  });

  const ev = rows.reduce(
    (acc, r) => acc.plus(new Decimal(r.projectedTotalProfit).mul(new Decimal(r.probability))),
    new Decimal(0),
  );

  const baseProfit = new Decimal(rows[1]!.projectedMonthlyProfit);
  const payback = baseProfit.gt(0)
    ? Math.ceil(capital.toDecimal().div(baseProfit).toNumber())
    : null;

  return {
    horizonMonths: horizon,
    scenarios: rows,
    probabilityWeightedEV: Money.from(ev).toDB(),
    paybackMonths: payback,
  };
}
