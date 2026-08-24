import { describe, expect, it } from "vitest";
import {
  computeOpportunityScores, SCORE_WEIGHTS, capitalPlan, checkExperimentBudget,
  checkDeployment, DEFAULT_GATES,
} from "../src/index.js";

const INPUT = {
  demandScore: 8, willingnessToPayScore: 7, profitabilityScore: 8, scalabilityScore: 6,
  defensibilityScore: 7, executionFeasibilityScore: 8, evidenceStrengthScore: 5,
  timeToRevenueScore: 6,
  revenuePotential: "1000000.00", costEstimate: "400000.00",
} as const;

describe("computeOpportunityScores (T07 — semua skor oleh engine)", () => {
  it("deterministik: input sama → output sama persis", () => {
    const a = computeOpportunityScores({ ...INPUT });
    const b = computeOpportunityScores({ ...INPUT });
    expect(a).toEqual(b);
  });

  it("opportunity_score = Σ sub×bobot, bobot Σ=1.00", () => {
    const sum = Object.values(SCORE_WEIGHTS).reduce((s, w) => s + w, 0);
    expect(sum).toBe(1);
    const r = computeOpportunityScores({ ...INPUT });
    // 8(.2)+7(.15)+8(.2)+6(.1)+7(.15)+8(.1)+5(.05)+6(.05) = 1.6+1.05+1.6+.6+1.05+.8+.25+.3 = 7.25
    expect(r.opportunityScore).toBe("7.25");
  });

  it("risk_score = .5(10−bukti)+.3(10−eksekusi)+.2(10−waktu)", () => {
    const r = computeOpportunityScores({ ...INPUT });
    // .5(10−5)+.3(10−8)+.2(10−6) = 2.5+.6+.8 = 3.90
    expect(r.riskScore).toBe("3.90");
  });

  it("p = (score/10)×(1−risk/20), EV = p×revenue − cost", () => {
    const r = computeOpportunityScores({ ...INPUT });
    // p = 0.725 × (1 − 0.195) = 0.583625 → dp4 0.5836
    expect(r.probabilityOfSuccess).toBe("0.5836");
    // EV memakai p PERSIST (0.5836, NUMERIC(5,4)): 0.5836×1.000.000 − 400.000 = 183.600,00
    expect(r.expectedValue).toBe("183600.00");
  });

  it("risk_adjusted_score = opportunity_score × p", () => {
    const r = computeOpportunityScores({ ...INPUT });
    // 7.25 × 0.5836 = 4.2311 → dp2 4.23
    expect(r.riskAdjustedScore).toBe("4.23");
  });

  it("clamp: skor sub >10 dipotong, <0 dinaikkan", () => {
    const r = computeOpportunityScores({ ...INPUT, demandScore: 99, willingnessToPayScore: -5 });
    expect(r.opportunityScore).toBe(computeOpportunityScores({ ...INPUT, demandScore: 10, willingnessToPayScore: 0 }).opportunityScore);
  });

  it("input order acak tetap sama (komutatif input objek)", () => {
    const a = computeOpportunityScores({ ...INPUT });
    const b = computeOpportunityScores({
      costEstimate: INPUT.costEstimate, revenuePotential: INPUT.revenuePotential,
      timeToRevenueScore: 6, evidenceStrengthScore: 5, executionFeasibilityScore: 8,
      defensibilityScore: 7, scalabilityScore: 6, profitabilityScore: 8,
      willingnessToPayScore: 7, demandScore: 8,
    });
    expect(a).toEqual(b);
  });
});

describe("capitalPlan §1 + gates §17", () => {
  it("Rp10jt → reserve 2jt, deployable 8jt, eksperimen 1jt", () => {
    expect(capitalPlan("10000000.00")).toEqual({
      total: "10000000.00", reserve20: "2000000.00",
      deployable: "8000000.00", experimentCap: "1000000.00",
    });
  });

  it("T09: budget > 1jt ditolak; ≤ lolos", () => {
    expect(checkExperimentBudget("1000000.01", DEFAULT_GATES).ok).toBe(false);
    expect(checkExperimentBudget("1000000.00", DEFAULT_GATES).ok).true;
    const bad = checkExperimentBudget("2000000.00", DEFAULT_GATES);
    if (bad.ok === false) expect(bad.code).toBe("BUDGET_EXCEEDED");
  });

  it("MAX_CAPITAL_DEPLOYMENT: 7jt+1jt lolos; 8jt+1jt ditolak", () => {
    expect(checkDeployment("7000000.00", "1000000.00", DEFAULT_GATES).ok).toBe(true);
    const bad = checkDeployment("8000000.00", "1000000.00", DEFAULT_GATES);
    if (bad.ok) throw new Error("harusnya GATE_VIOLATION");
    expect(bad.rule).toBe("MAX_CAPITAL_DEPLOYMENT");
    expect(bad.detail).toBe("9000000.00 > 8000000.00");
  });
});
