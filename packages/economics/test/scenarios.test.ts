import { describe, expect, it } from "vitest";
import { buildScenarios } from "../src/scenarios.js";

const BASE = {
  monthlyRevenue: "10000000.00",     // Rp10jt
  monthlyOperatingProfit: "2000000.00", // Rp2jt
  capitalRemaining: "6000000.00",
  horizonMonths: 3,
};

describe("buildScenarios (§15) — deterministik dari snapshot nyata", () => {
  it("BEAR −30% / BASE ±0% / BULL +25% dengan margin konstan", () => {
    const r = buildScenarios(BASE);
    const byName = Object.fromEntries(r.scenarios.map((s) => [s.name, s]));
    expect(byName.BEAR!.projectedMonthlyRevenue).toBe("7000000.00");
    expect(byName.BASE!.projectedMonthlyProfit).toBe("2000000.00");
    expect(byName.BULL!.projectedMonthlyProfit).toBe("2500000.00");
    // total = bulanan × horizon
    expect(byName.BEAR!.projectedTotalProfit).toBe("4200000.00");
    expect(byName.BULL!.projectedTotalProfit).toBe("7500000.00");
  });

  it("EV tertimbang probabilitas & payback dari profit BASE", () => {
    const r = buildScenarios(BASE);
    // EV = 0.3×4.2jt + 0.45×6jt + 0.25×7.5jt = 1.26+2.7+1.875 = 5.835jt
    expect(r.probabilityWeightedEV).toBe("5835000.00");
    // payback = ceil(6jt ÷ 2jt) = 3
    expect(r.paybackMonths).toBe(3);
  });

  it("profit negatif → payback null (bukan angka palsu), EV bisa negatif", () => {
    const r = buildScenarios({ ...BASE, monthlyOperatingProfit: "-1000000.00" });
    expect(r.paybackMonths).toBeNull();
    expect(r.probabilityWeightedEV.startsWith("-")).toBe(true);
  });

  it("horizon di-clamp 1..12; revenue negatif ditolak", () => {
    expect(buildScenarios({ ...BASE, horizonMonths: 99 }).horizonMonths).toBe(12);
    expect(buildScenarios({ ...BASE, horizonMonths: 0 }).horizonMonths).toBe(1);
    expect(() =>
      buildScenarios({ ...BASE, monthlyRevenue: "-1.00" }),
    ).toThrow();
  });
});
