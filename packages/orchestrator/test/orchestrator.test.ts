import { describe, expect, it } from "vitest";
import { advance, isTerminal } from "@aee/orchestrator";
import type { FsmState, GuardContext } from "@aee/domain";

const now = new Date("2026-08-22T00:00:00Z");

function ctx(state: FsmState, over: Partial<GuardContext> = {}): GuardContext {
  return {
    state,
    now,
    objective: {
      id: "11111111-1111-1111-1111-111111111111",
      createdAt: "2026-08-22T00:00:00.000Z",
      deadline: "2027-08-22",
      capitalApproved: "10000000.00",
      horizonMonths: 12,
      autonomyLevel: 3,
      riskTolerance: "moderate",
    },
    cycle: { activeCount: 0 },
    research: { opportunityCount: 1, retryCount: 0 },
    selection: { inRankedList: true, capitalGatePass: true },
    risk: { level: "moderate" },
    experiment: { budget: "500000.00", maxSingleExperimentLoss: "1000000.00", windowComplete: true },
    mission: { schemaValid: true, humanApproved: false, activeExecutionCount: 0, nextVersionCreated: true, budgetGatePass: true },
    result: { schemaValid: true, partial: false },
    decision: {
      kind: "SCALE", schemaValid: true, evidenceCount: 1,
      ledgerSupportsScale: true, pivotCount: 0, killCount: 0,
      alternativesExist: true, rankedEmpty: false, learningsArchived: true,
    },
    global: {
      stopRequested: false, drawdown: "0.00", maxTotalDrawdown: "4000000.00",
      evNegativeStreak: 0, consecutiveMissionFailures: 0, providerErrorRate1h: 0,
      approvalPending: false, securityAnomaly: false,
      currentProfit: "0.00", targetProfit: "100000000.00",
    },
    ...over,
  };
}

describe("happy walk — jalur utama T01→T37 (data sehat)", () => {
  it("berjalan penuh tanpa penolakan", () => {
    const steps: Array<[FsmState, Parameters<typeof advance>[1], FsmState]> = [
      ["IDLE", "create_objective", "OBJECTIVE_CREATED"],            // T01
      ["OBJECTIVE_CREATED", "normalize", "OBJECTIVE_VALIDATED"],    // T02
      ["OBJECTIVE_VALIDATED", "start_research", "RESEARCHING"],     // T03
      ["RESEARCHING", "kimi_research_ok", "RESEARCH_COMPLETE"],     // T04
      ["RESEARCH_COMPLETE", "analyze", "ANALYZING"],                // T06
      ["ANALYZING", "ranked", "OPPORTUNITIES_RANKED"],              // T07
      ["OPPORTUNITIES_RANKED", "kimi_select", "OPPORTUNITY_SELECTED"], // T08
      ["OPPORTUNITY_SELECTED", "experiment_created", "VALIDATING"], // T09
      ["VALIDATING", "experiment_done", "RESULT_READY"],            // T10
      ["RESULT_READY", "kimi_mission", "MISSION_CREATED"],          // T12
      ["MISSION_CREATED", "approve", "MISSION_APPROVED"],           // T13 (autonomy 3)
      ["MISSION_APPROVED", "dispatch_glm", "EXECUTING"],            // T15
      ["EXECUTING", "glm_result", "EXECUTION_COMPLETED"],           // T16
      ["EXECUTION_COMPLETED", "measure_start", "MEASURING"],        // T18
      ["MEASURING", "measured", "RESULT_READY"],                    // T19
      ["RESULT_READY", "kimi_analyze", "RESULT_ANALYZING"],         // T20
      ["RESULT_ANALYZING", "kimi_decide", "DECISION_READY"],        // T21
      ["DECISION_READY", "decision=SCALE", "SCALING"],              // T22
      ["SCALING", "mission_v_next", "MISSION_CREATED"],             // T28
    ];
    for (const [from, trigger, expected] of steps) {
      const out = advance(from, trigger, ctx(from));
      if (!out.ok) throw new Error(`${from} --${trigger}--> GAGAL: ${out.reason}`);
      expect(out.resolvedTo).toBe(expected);
    }
  });

  it("T37: ACHIEVED saat profit ledger ≥ target", () => {
    const out = advance("DECISION_READY", "profit>=target", ctx("DECISION_READY", {
      global: {
        stopRequested: false, drawdown: "0.00", maxTotalDrawdown: "4000000.00",
        evNegativeStreak: 0, consecutiveMissionFailures: 0, providerErrorRate1h: 0,
        approvalPending: false, securityAnomaly: false,
        currentProfit: "100000000.00", targetProfit: "100000000.00",
      },
    }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.resolvedTo).toBe("ACHIEVED");
  });

  it("T11: skip_experiment legal saat autonomy ≥ 3 dan risk < high", () => {
    const out = advance("OPPORTUNITY_SELECTED", "skip_experiment", ctx("OPPORTUNITY_SELECTED"));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.resolvedTo).toBe("MISSION_CREATED");
  });
});

describe("penolakan (negative probes FSM)", () => {
  it("transisi ilegal → INVALID_TRANSITION", () => {
    const out = advance("IDLE", "dispatch_glm", ctx("IDLE"));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("INVALID_TRANSITION");
  });

  it("T02 deadline NULL: fallback createdAt+horizon (GAP-07) — segar lolos, basi gagal", () => {
    // createdAt segar (2026-08-22) + horizon 12 bln → 2027-08-22 > now → guard lolos
    const fresh = advance("OBJECTIVE_CREATED", "normalize", ctx("OBJECTIVE_CREATED", {
      objective: { ...ctx("OBJECTIVE_CREATED").objective, deadline: null },
    }));
    expect(fresh.ok).toBe(true);
    // createdAt 2020 + horizon 12 bln → 2021 ≤ now 2026 → GUARD_FAILED
    const stale = advance("OBJECTIVE_CREATED", "normalize", ctx("OBJECTIVE_CREATED", {
      objective: { ...ctx("OBJECTIVE_CREATED").objective, deadline: null, createdAt: "2020-01-01T00:00:00.000Z" },
    }));
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.code).toBe("GUARD_FAILED");
  });

  it("T02 dengan horizon lewat → GUARD_FAILED", () => {
    const out = advance("OBJECTIVE_CREATED", "normalize", ctx("OBJECTIVE_CREATED", {
      objective: { ...ctx("OBJECTIVE_CREATED").objective, deadline: "2020-01-01" },
    }));
    expect(out.ok).toBe(false);
  });

  it("T03 saat cycle aktif → GUARD_FAILED (lock)", () => {
    const out = advance("OBJECTIVE_VALIDATED", "start_research", ctx("OBJECTIVE_VALIDATED", { cycle: { activeCount: 1 } }));
    expect(out.ok).toBe(false);
  });

  it("T05: kimi_fail dengan retry < 3 → GUARD_FAILED (masih retry)", () => {
    const out = advance("RESEARCHING", "kimi_fail", ctx("RESEARCHING", { research: { opportunityCount: 0, retryCount: 2 } }));
    expect(out.ok).toBe(false);
  });

  it("T05: kimi_fail dengan retry ≥ 3 → BLOCKED", () => {
    const out = advance("RESEARCHING", "kimi_fail", ctx("RESEARCHING", { research: { opportunityCount: 0, retryCount: 3 } }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.resolvedTo).toBe("BLOCKED");
  });

  it("T17: glm_fail retry 3 → BLOCKED; retry 1 → masih gagal guard", () => {
    const out3 = advance("EXECUTING", "glm_fail", ctx("EXECUTING", { glm: { retryCount: 3 } }));
    expect(out3.ok).toBe(true);
    const out1 = advance("EXECUTING", "glm_fail", ctx("EXECUTING", { glm: { retryCount: 1 } }));
    expect(out1.ok).toBe(false);
  });

  it("T08: pilihan ∉ ranked → GUARD_FAILED", () => {
    const out = advance("OPPORTUNITIES_RANKED", "kimi_select", ctx("OPPORTUNITIES_RANKED", { selection: { inRankedList: false, capitalGatePass: true } }));
    expect(out.ok).toBe(false);
  });

  it("T09: budget eksperimen di atas gate → GUARD_FAILED", () => {
    const out = advance("OPPORTUNITY_SELECTED", "experiment_created", ctx("OPPORTUNITY_SELECTED", { experiment: { budget: "1500000.00", maxSingleExperimentLoss: "1000000.00", windowComplete: false } }));
    expect(out.ok).toBe(false);
  });

  it("T21: decision tanpa evidence → GUARD_FAILED (GAP-05)", () => {
    const out = advance("RESULT_ANALYZING", "kimi_decide", ctx("RESULT_ANALYZING", {
      decision: { ...ctx("RESULT_ANALYZING").decision!, evidenceCount: 0 },
    }));
    expect(out.ok).toBe(false);
  });

  it("T15: execution aktif lain → GUARD_FAILED (unique index DB juga)", () => {
    const out = advance("MISSION_APPROVED", "dispatch_glm", ctx("MISSION_APPROVED", { mission: { ...ctx("MISSION_APPROVED").mission!, activeExecutionCount: 1 } }));
    expect(out.ok).toBe(false);
  });

  it("T38: STOPPED dari state mana pun (kondisi stop tidak menghalangi)", () => {
    const out = advance("RESEARCHING", "stop_objective", ctx("RESEARCHING"));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.resolvedTo).toBe("STOPPED");
  });

  it("stop condition global aktif → GLOBAL_STOP utk trigger biasa", () => {
    const out = advance("RESEARCH_COMPLETE", "analyze", ctx("RESEARCH_COMPLETE", {
      global: { ...ctx("RESEARCH_COMPLETE").global!, evNegativeStreak: 2 },
    }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("GLOBAL_STOP");
  });

  it("terminal: tidak ada transisi keluar dari ACHIEVED/STOPPED", () => {
    expect(advance("ACHIEVED", "stop_objective", ctx("ACHIEVED")).ok).toBe(false);
    expect(advance("STOPPED", "resume", ctx("STOPPED")).ok).toBe(false);
    expect(isTerminal("ACHIEVED") && isTerminal("STOPPED")).toBe(true);
  });

  it("T34 approve mengembalikan '{resume_state}' (target di-resolve layer DB)", () => {
    const out = advance("HUMAN_APPROVAL_REQUIRED", "approve", ctx("HUMAN_APPROVAL_REQUIRED"));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.resolvedTo).toBe("{resume_state}");
  });
});
