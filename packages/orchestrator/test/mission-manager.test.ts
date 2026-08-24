/**
 * Unit test mission-manager (Phase 8–9) — murni, tanpa DB: kita uji decisionTrigger
 * + evNegativeStreak logic via FSM table + cabang melalui domain.step, dan
 * result-processor pure parts (verifyHmac via processPaymentWebhook dengan
 * ScriptedClient). DB integration penuh ada di scripts/verify-orchestrator.ts.
 */
import { describe, expect, it } from "vitest";
import { step, type GuardContext } from "@aee/domain";
import { evaluateGuard } from "../src/index.js";
import { decisionTrigger } from "../src/runtime.js";
import { achievedFromLedger } from "@aee/economics";
import { createHmac } from "node:crypto";

function ctx(partial: Partial<GuardContext> = {}): GuardContext {
  return {
    state: "DECISION_READY",
    now: new Date("2026-08-23T00:00:00Z"),
    objective: {
      id: "00000000-0000-4000-8000-000000000001",
      createdAt: "2026-08-22T00:00:00.000Z",
      deadline: "2027-08-22",
      capitalApproved: "10000000.00",
      horizonMonths: 12,
      autonomyLevel: 4,
      riskTolerance: "moderate",
    },
    decision: {
      kind: "ITERATE", schemaValid: true, evidenceCount: 1,
      ledgerSupportsScale: false, pivotCount: 0, killCount: 0,
      alternativesExist: true, rankedEmpty: false, learningsArchived: true,
    },
    ...partial,
  } as GuardContext;
}

describe("decisionTrigger — decision → trigger T22–T27", () => {
  it("SCALE/ITERATE/PIVOT/KILL/WAIT/ESCALATE semua punya trigger", () => {
    expect(decisionTrigger("SCALE")).toBe("decision=SCALE");
    expect(decisionTrigger("ITERATE")).toBe("decision=ITERATE");
    expect(decisionTrigger("PIVOT")).toBe("decision=PIVOT");
    expect(decisionTrigger("KILL")).toBe("decision=KILL");
    expect(decisionTrigger("WAIT_FOR_INFORMATION")).toBe("decision=WAIT_FOR_INFORMATION");
    expect(decisionTrigger("ESCALATE_TO_HUMAN")).toBe("decision=ESCALATE");
    expect(decisionTrigger("SELECT")).toBeNull();
    expect(decisionTrigger("BLOCKED")).toBeNull();
  });

  it("T23 ITERATE + mission_version_next_created → ITERATING", () => {
    const out = step("DECISION_READY", "decision=ITERATE",
      ctx({ mission: { schemaValid: true, humanApproved: false, activeExecutionCount: 0, nextVersionCreated: true, budgetGatePass: true } }),
      evaluateGuard);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.transition.to).toBe("ITERATING");
  });

  it("T23 ITERATE tanpa mission v+1 → GUARD_FAILED", () => {
    const out = step("DECISION_READY", "decision=ITERATE",
      ctx({ mission: { schemaValid: true, humanApproved: false, activeExecutionCount: 0, nextVersionCreated: false, budgetGatePass: true } }),
      evaluateGuard);
    expect(out.ok).toBe(false);
  });

  it("T22 SCALE + ledger mendukung + gates → SCALING", () => {
    const out = step("DECISION_READY", "decision=SCALE",
      ctx({ decision: { kind: "SCALE", schemaValid: true, evidenceCount: 2, ledgerSupportsScale: true, pivotCount: 0, killCount: 0, alternativesExist: true, rankedEmpty: false, learningsArchived: true } }),
      evaluateGuard);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.transition.to).toBe("SCALING");
  });

  it("T24 PIVOT ketiga kali → GUARD_FAILED (pivot_count_lt_3)", () => {
    const out = step("DECISION_READY", "decision=PIVOT",
      ctx({ decision: { kind: "PIVOT", schemaValid: true, evidenceCount: 1, ledgerSupportsScale: false, pivotCount: 3, killCount: 0, alternativesExist: true, rankedEmpty: false, learningsArchived: true } }),
      evaluateGuard);
    expect(out.ok).toBe(false);
  });

  it("T30 PIVOTING + learnings archived → RESEARCHING", () => {
    const out = step("PIVOTING", "research_new", ctx(), evaluateGuard);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.transition.to).toBe("RESEARCHING");
  });

  it("T31 KILLING + alternatif ada + kill<3 → OPPORTUNITIES_RANKED", () => {
    const out = step("KILLING", "reselect",
      ctx({ decision: { kind: "KILL", schemaValid: true, evidenceCount: 1, ledgerSupportsScale: false, pivotCount: 0, killCount: 1, alternativesExist: true, rankedEmpty: false, learningsArchived: true } }),
      evaluateGuard);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.transition.to).toBe("OPPORTUNITIES_RANKED");
  });

  it("T28 SCALING + budget gate → MISSION_CREATED; T29 ITERATING tanpa guard → MISSION_CREATED", () => {
    const m28 = ctx({ mission: { schemaValid: true, humanApproved: false, activeExecutionCount: 0, nextVersionCreated: true, budgetGatePass: true } });
    const a = step("SCALING", "mission_v_next", m28, evaluateGuard);
    expect(a.ok).toBe(true);
    const b = step("ITERATING", "mission_v_next", m28, evaluateGuard);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.transition.to).toBe("MISSION_CREATED");
      expect(b.transition.to).toBe("MISSION_CREATED");
    }
  });

  it("T37 profit dari ledger ≥ target → ACHIEVED; kurang → GUARD_FAILED", () => {
    const g = ctx({
      global: {
        stopRequested: false, drawdown: "0.00", maxTotalDrawdown: "4000000.00",
        evNegativeStreak: 0, consecutiveMissionFailures: 0, providerErrorRate1h: 0,
        approvalPending: false, securityAnomaly: false,
        currentProfit: "5000000.00", targetProfit: "5000000.00",
      },
    });
    const ok = step("DECISION_READY", "profit>=target", g, evaluateGuard);
    expect(ok.ok).toBe(true);
    const g2 = ctx({
      global: {
        stopRequested: false, drawdown: "0.00", maxTotalDrawdown: "4000000.00",
        evNegativeStreak: 0, consecutiveMissionFailures: 0, providerErrorRate1h: 0,
        approvalPending: false, securityAnomaly: false,
        currentProfit: "4999999.99", targetProfit: "5000000.00",
      },
    });
    const no = step("DECISION_READY", "profit>=target", g2, evaluateGuard);
    expect(no.ok).toBe(false);
  });

  it("T39 EV<0 dua siklus → BLOCKED; kurang dari 2 → GUARD_FAILED", () => {
    const base = {
      stopRequested: false, drawdown: "0.00", maxTotalDrawdown: "4000000.00",
      consecutiveMissionFailures: 0, providerErrorRate1h: 0,
      approvalPending: false, securityAnomaly: false,
      currentProfit: "0.00", targetProfit: "1000000.00",
    };
    const yes = step("DECISION_READY", "ev_negative",
      ctx({ global: { ...base, evNegativeStreak: 2 } }), evaluateGuard);
    expect(yes.ok).toBe(true);
    const no = step("DECISION_READY", "ev_negative",
      ctx({ global: { ...base, evNegativeStreak: 1 } }), evaluateGuard);
    expect(no.ok).toBe(false);
  });

  it("T20+T21 rangkaian: RESULT_READY → RESULT_ANALYZING → DECISION_READY", () => {
    const r20 = step("RESULT_READY", "kimi_analyze", ctx({ state: "RESULT_READY" }), evaluateGuard);
    expect(r20.ok).toBe(true);
    const r21 = step("RESULT_ANALYZING", "kimi_decide", ctx({ state: "RESULT_ANALYZING" }), evaluateGuard);
    expect(r21.ok).toBe(true);
    if (r20.ok && r21.ok) {
      expect(r20.transition.to).toBe("RESULT_ANALYZING");
      expect(r21.transition.to).toBe("DECISION_READY");
    }
  });

  it("T21 dengan evidence kosong → GUARD_FAILED (GAP-05)", () => {
    const out = step("RESULT_ANALYZING", "kimi_decide",
      ctx({ state: "RESULT_ANALYZING", decision: { kind: "ITERATE", schemaValid: true, evidenceCount: 0, ledgerSupportsScale: false, pivotCount: 0, killCount: 0, alternativesExist: true, rankedEmpty: false, learningsArchived: true } }),
      evaluateGuard);
    expect(out.ok).toBe(false);
  });
});

describe("result-processor — HMAC & tier", () => {
  it("HMAC benar diterima, salah ditolak (timing-safe)", async () => {
    const { processPaymentWebhook } = await import("../src/result-processor.js");
    const secret = "whsec-test";
    const body = JSON.stringify({
      external_id: "pkg-1:1:1", amount: "100000.00", kind: "REVENUE", provider: "xendit",
    });
    const sig = createHmac("sha256", secret).update(body, "utf8").digest("hex");
    // client scripted: tidak ada execution → EXECUTION_NOT_FOUND (tapi lewat verifikasi signature dulu)
    const client = {
      query: async () => ({ rows: [], rowCount: 0 }),
    } as unknown as import("pg").PoolClient;
    const okSig = await processPaymentWebhook(
      client,
      { external_id: "pkg-1:1:1", amount: "100000.00", kind: "REVENUE", provider: "xendit" },
      body, sig, secret);
    expect(okSig.ok).toBe(false);
    expect(okSig.code).toBe("EXECUTION_NOT_FOUND"); // signature lolos → sampai lookup

    const badSig = await processPaymentWebhook(
      client,
      { external_id: "pkg-1:1:1", amount: "100000.00", kind: "REVENUE", provider: "xendit" },
      body, "deadbeef", secret);
    expect(badSig.ok).toBe(false);
    expect(badSig.code).toBe("SIGNATURE_INVALID"); // ditolak SEBELUM menyentuh DB
  });

  it("determineTier: revenue>0 + evidence → EVIDENCED; tanpa → SELF_REPORTED", async () => {
    const { determineTier } = await import("@aee/contracts");
    const { GlmResultSchema } = await import("@aee/contracts");
    const mk = (revenue: string, ev: unknown[]) => GlmResultSchema.parse({
      mission_id: "11111111-1111-4111-8111-111111111111", mission_version: 1,
      execution_id: "22222222-2222-4222-8222-222222222222", status: "SUCCEEDED",
      objective_status: "ON_TRACK", summary: "s",
      work: { completed: [], files_created: [], files_modified: [], files_deleted: [], systems_changed: [] },
      verification: { tests_run: 0, test_results: { passed: 0, failed: 0 }, build_result: "PASS", deployment_result: "PASS", runtime_result: "PASS" },
      business_metrics: { traffic: 0, leads: 0, customers: 0, conversions: 0, revenue, cost: "0.00", profit: "0.00", cac: "0.00", retention: 0 },
      signals: { observed_market_signal: "", customer_signal: "" },
      errors: [], blockers: [], assumptions: [], unverified_items: [],
      recommendation: "CONTINUE",
      evidence: ev,
    });
    expect(determineTier(mk("100000.00", [{ kind: "url", uri: "https://x", sha256: "a".repeat(64) }])).tier)
      .toBe("EVIDENCED");
    expect(determineTier(mk("100000.00", [])).tier).toBe("SELF_REPORTED");
    expect(determineTier(mk("0.00", [])).tier).toBe("SELF_REPORTED");
  });

  it("achievedFromLedger — netProfit dari ledger, bukan klaim", () => {
    expect(achievedFromLedger("1000000.00", "1000000.00")).toBe(true);
    expect(achievedFromLedger("999999.99", "1000000.00")).toBe(false);
  });
});
