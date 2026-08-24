/**
 * @aee/agents tests — Phase 4–5.
 * Semua transport di-mock; sleeper & clock disuntik → deterministik, tanpa jaringan.
 */
import { describe, expect, it } from "vitest";
import {
  AgentExhaustedError, AgentFatalError, AgentSchemaError, AgentTransientError,
  BACKOFF_MS, GlmAdapter, KimiAdapter, MockExecutionAgent, MockStrategicAgent,
  type ChatResponse, type ChatTransport, canonicalJson, parseModelJson, runValidated, sha256Hex,
} from "@aee/agents";
import {
  type GlmResult,
  DecisionRecordSchema, GlmResultSchema, MissionPackageSchema, ResearchOutputSchema,
  SelectDecisionSchema, determineTier, intakeResult,
} from "@aee/contracts";
import { advance } from "@aee/orchestrator";
import type { GuardContext } from "@aee/domain";
import { randomUUID } from "node:crypto";

const noSleep = async () => {};
const clock = () => 1_000_000;

function chat(content: string): ChatResponse {
  return { choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 20 } };
}

/** Transport scripted: tiap panggilan mengembalikan item berikutnya (atau throw fn). */
function scripted(steps: Array<string | Error>): ChatTransport & { calls: number } {
  let i = 0;
  const t = async (): Promise<ChatResponse> => {
    const s = steps[Math.min(i, steps.length - 1)]!;
    i += 1;
    t.calls = i;
    if (s instanceof Error) throw s;
    return chat(s);
  };
  t.calls = 0;
  return t as ChatTransport & { calls: number };
}

const okResearch = JSON.stringify({ opportunities: [{
  name: "X", customer_segment: "s", problem: "p", solution: "v", business_model: "m",
  assumptions: [], unknowns: [],
}] });

// ── Retry/backoff (§3.1: 30s/2m/8m, max 3) ───────────────────────────────────

describe("retry & backoff", () => {
  it("transient → backoff 30s/2m/8m lalu sukses pada percobaan ke-3", async () => {
    const delays: number[] = [];
    const sleep = async (ms: number) => { delays.push(ms); };
    const transport: ChatTransport = async () => { throw new AgentTransientError("503"); };
    let calls = 0;
    const ok: ChatTransport = async () => { calls += 1; if (calls < 3) throw new AgentTransientError("503"); return chat(okResearch); };
    const { value, run } = await runValidated({
      agent: "KIMI", purpose: "research", promptVersionId: "t", input: { a: 1 },
      schema: ResearchOutputSchema, transport: ok, model: "kimi-k3", modelVersion: "kimi-k3",
      temperature: 0.4, tokenLimit: 1024, sleeper: sleep, clock, allowRepair: true,
    });
    expect(value.opportunities).toHaveLength(1);
    expect(delays).toEqual([30_000, 120_000]);
    expect(run.retries).toBe(2);
    void transport;
  });

  it("4× transient berturut → AgentExhaustedError(retryCount=3) setelah backoff penuh", async () => {
    const delays: number[] = [];
    const t: ChatTransport = async () => { throw new AgentTransientError("timeout"); };
    await expect(runValidated({
      agent: "GLM", purpose: "execute", promptVersionId: "t", input: {},
      schema: GlmResultSchema, transport: t, model: "glm-4.6", modelVersion: "glm-4.6",
      temperature: 0.1, tokenLimit: 1024,
      sleeper: async (ms) => { delays.push(ms); }, clock, allowRepair: false,
    })).rejects.toBeInstanceOf(AgentExhaustedError);
    expect(delays).toEqual([...BACKOFF_MS]);
  });

  it("fatal (HTTP 401) → TANPA retry, dilempar langsung", async () => {
    let calls = 0;
    const t: ChatTransport = async () => { calls += 1; throw new AgentFatalError("HTTP 401", 401); };
    await expect(runValidated({
      agent: "KIMI", purpose: "research", promptVersionId: "t", input: {},
      schema: ResearchOutputSchema, transport: t, model: "k", modelVersion: "k",
      temperature: 0.4, tokenLimit: 8, sleeper: noSleep, clock, allowRepair: true,
    })).rejects.toBeInstanceOf(AgentFatalError);
    expect(calls).toBe(1);
  });
});

// ── Parse & repair-loop ──────────────────────────────────────────────────────

describe("parse & repair-loop", () => {
  it("parseModelJson menangkap code-fence markdown", () => {
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("Kimi: output invalid sekali → repair ke-2 valid → SUCCEEDED + run terekam", async () => {
    const t = scripted([JSON.stringify({ bogus: true }), okResearch]);
    const adapter = new KimiAdapter({ transport: t as ChatTransport, sleeper: noSleep, clock });
    const out = await adapter.research({ objective: OBJ });
    expect(out.opportunities).toHaveLength(1);
    expect(adapter.runs).toHaveLength(1);
    expect(adapter.runs[0]!.status).toBe("SUCCEEDED");
    expect(adapter.runs[0]!.purpose).toBe("research");
  });

  it("Kimi: invalid dua kali (repair 1× habis) → AgentSchemaError", async () => {
    const t = scripted(["nope", '{"opportunities":[]}']);
    const adapter = new KimiAdapter({ transport: t, sleeper: noSleep, clock });
    await expect(adapter.research({ objective: OBJ })).rejects.toBeInstanceOf(AgentSchemaError);
  });

  it("GLM: repair 1× — invalid dua kali → reject, transport dipanggil 2×", async () => {
    const t = scripted(['{"status":"SUCCEEDED"}', '{"status":"SUCCEEDED"}']);
    const glm = new GlmAdapter({ transport: t, sleeper: noSleep, clock });
    const pkg = missionPkg();
    await expect(glm.executeMission(pkg, "idem-1")).rejects.toBeInstanceOf(AgentSchemaError);
    expect(t.calls).toBe(2);
  });
});

// ── Anti-halusinasi & gate (§9/§10) ─────────────────────────────────────────

describe("integritas referensi & gate", () => {
  it("GLM: mission_id tidak cocok → ditolak walau schema-valid (§10-2)", async () => {
    const r = validGlmResult();
    r.mission_id = randomUUID();
    const glm = new GlmAdapter({ transport: scripted([JSON.stringify(r)]), sleeper: noSleep, clock });
    await expect(glm.executeMission(missionPkg(), "idem-2")).rejects.toThrow(/mission_id|referensi misi/);
  });

  it("GLM: execution_id ≠ ctx.executionId → ditolak (§10-2)", async () => {
    const pkg = missionPkg();
    const r = validGlmResult(); // uuid sinkron dengan pkg terakhir
    const glm = new GlmAdapter({ transport: scripted([JSON.stringify(r)]), sleeper: noSleep, clock });
    await expect(glm.executeMission(pkg, "idem-3", { executionId: randomUUID(), cycleId: randomUUID() }))
      .rejects.toThrow(/execution_id/);
  });

  it("Kimi.rank_select memilih di luar ranked list → AgentSchemaError (T08)", async () => {
    const decision = SelectDecisionSchema.parse({
      selected_opportunity_id: randomUUID(), reason: "x".repeat(60), confidence: 0.5, assumptions: [],
    });
    const adapter = new KimiAdapter({ transport: scripted([JSON.stringify(decision)]), sleeper: noSleep, clock });
    await expect(adapter.rank_select({ objective: OBJ, opportunities: [ranked(randomUUID())] }))
      .rejects.toThrow(/ranked list/);
  });

  it("Kimi.designExperiment budget > MAX_SINGLE_EXPERIMENT_LOSS → ditolak (T09)", async () => {
    const spec = {
      opportunity_id: randomUUID(), hypothesis: "h", objective: "o", budget: "2000000.00",
      duration_days: 7, success_metric: "m", success_threshold: "0.1000", failure_threshold: "0.0100",
      kill_criteria: ["k"], scale_criteria: ["s"], information_gain_target: "i",
    };
    const adapter = new KimiAdapter({ transport: scripted([JSON.stringify(spec)]), sleeper: noSleep, clock });
    await expect(adapter.designExperiment({
      objective: OBJ, opportunity: ranked(randomUUID()),
      policies: { maxSingleExperimentLoss: "1000000.00" },
    })).rejects.toThrow(/MAX_SINGLE_EXPERIMENT_LOSS/);
  });

  it("Kimi.interpretResults evidence ∉ DB → ditolak (§9 aturan keras)", async () => {
    const decision = DecisionRecordSchema.parse({
      decision: "ITERATE", subject_id: randomUUID(), reason: "y".repeat(60),
      evidence_ids: [randomUUID()], metrics: {}, assumptions: [], confidence: 0.5,
      expected_value_next: "1000.00",
    });
    const adapter = new KimiAdapter({ transport: scripted([JSON.stringify(decision)]), sleeper: noSleep, clock });
    await expect(adapter.interpretResults({
      objective: OBJ, mission: { id: randomUUID(), version: 1 },
      glmResult: validGlmResult(), evidenceIds: [randomUUID()],
    })).rejects.toThrow(/bukti nyata|evidence_ids/);
  });
});

// ── Reproducibility (§12): hash kanonik deterministik ───────────────────────

describe("reproducibility", () => {
  it("canonicalJson urut kunci rekursif → hash identik walau urutan field beda", () => {
    const a = { b: 1, a: { d: [3, { z: 1, y: 2 }], c: 2 } };
    const b = { a: { c: 2, d: [3, { y: 2, z: 1 }] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(sha256Hex(canonicalJson(a))).toBe(sha256Hex(canonicalJson(b)));
  });

  it("ModelRunRecord mencatat temperature 2-desimal + inputContextHash dari input", async () => {
    const adapter = new KimiAdapter({ transport: scripted([okResearch]), sleeper: noSleep, clock });
    await adapter.research({ objective: OBJ });
    const run = adapter.runs[0]!;
    expect(run.temperature).toBe("1.00"); // research = 1 (streamlake/kimi-k3 only accepts temp=1)
    expect(run.inputContextHash).toBe(sha256Hex(canonicalJson({ objective: OBJ })));
    expect(run.agent).toBe("KIMI");
  });
});

// ── Mock providers & tier D8 ─────────────────────────────────────────────────

describe("mock providers (SIMULATED §36)", () => {
  it("rantai lengkap mock: research→select→experiment→mission→execute→intake→decide — semua schema-valid", async () => {
    const kimi = new MockStrategicAgent();
    const glm = new MockExecutionAgent();

    const research = await kimi.research({ objective: OBJ });
    expect(research.opportunities.length).toBeGreaterThanOrEqual(1);

    const rankedList = research.opportunities.map((o, i) => ranked(randomUUID(), o.name, i));
    const sel = await kimi.rank_select({ objective: OBJ, opportunities: rankedList });
    expect(rankedList.some((r) => r.id === sel.selected_opportunity_id)).toBe(true);

    const chosen = rankedList.find((r) => r.id === sel.selected_opportunity_id)!;
    const spec = await kimi.designExperiment({
      objective: OBJ, opportunity: chosen, policies: { maxSingleExperimentLoss: "1000000.00" },
    });
    expect(parseFloat(spec.budget)).toBeLessThanOrEqual(1_000_000);

    const decision1 = DecisionRecordSchema.parse({
      decision: "ITERATE", subject_id: chosen.id, reason: "r".repeat(60),
      evidence_ids: [randomUUID()], metrics: {}, assumptions: [], confidence: 0.6,
      expected_value_next: "1500000.00",
    });
    const pkg = await kimi.designMission({ objective: OBJ, opportunity: chosen, decision: decision1 });
    expect(pkg.mission_version).toBe(1);
    expect(MissionPackageSchema.parse(pkg)).toEqual(pkg); // idempotent parse

    const executionId = randomUUID();
    const handle = await glm.executeMission(pkg, `${pkg.mission_id}:1:1`, { executionId, cycleId: randomUUID() });
    const result = handle.result!;
    expect(result.execution_id).toBe(executionId);

    // intake §10-2/3
    const intake = intakeResult({
      result, execution: { missionId: pkg.mission_id, missionVersion: 1, executionId, status: "RUNNING" },
    });
    expect(intake).toMatchObject({ accepted: true, verificationTier: "SELF_REPORTED", ledgerWritten: false });
    expect(determineTier(result).tier).toBe("SELF_REPORTED"); // revenue 0 + tanpa evidence

    const decision2 = await kimi.interpretResults({
      objective: OBJ, mission: { id: pkg.mission_id, version: 1 },
      glmResult: result, evidenceIds: [decision1.evidence_ids[0]!],
    });
    expect(decision2.decision).toBe("ITERATE"); // recommendation CONTINUE → ITERATE

    // setiap panggilan tercatat sebagai model_runs
    expect(kimi.runs).toHaveLength(5);
    expect(glm.runs).toHaveLength(1);
    expect(new Set(kimi.runs.map((r) => r.purpose))).toEqual(
      new Set(["research", "rank_select", "design_experiment", "design_mission", "interpret_results"]),
    );
  });

  it("mock revenue>0 TANPA evidence → tetap SELF_REPORTED (anti sukses-palsu D8)", async () => {
    const glm = new MockExecutionAgent({ revenue: "500000.00" });
    const pkg = missionPkg();
    const r = (await glm.executeMission(pkg, "k")).result!;
    expect(determineTier(r).tier).toBe("SELF_REPORTED");
    expect(determineTier(r).ledgerWritten).toBe(false);
  });

  it("GLM handle: getStatus SUCCEEDED, cancel → tidak lagi punya result", async () => {
    const glm = new MockExecutionAgent();
    const h = await glm.executeMission(missionPkg(), "kk");
    expect(await glm.getStatus(h.ref)).toBe("SUCCEEDED");
    await glm.cancel(h.ref);
    expect(await glm.getStatus(h.ref)).toBe("RUNNING");
    await expect(glm.getStatus("tak-ada")).rejects.toBeInstanceOf(AgentFatalError);
  });
});

// ── Integrasi FSM: exhaustion → T05/T17 → BLOCKED ───────────────────────────

describe("FSM integration (T05/T17)", () => {
  it("AgentExhaustedError memuat retryCount=3 — siap guard retry_ge_3", () => {
    const e = new AgentExhaustedError(3, new AgentTransientError("x"));
    expect(e.retryCount).toBe(3);
    expect(e.message).toMatch(/3/);
  });

  it("RESEARCHING + kimi_fail + research.retryCount=3 → BLOCKED (T05)", () => {
    const out = advance("RESEARCHING", "kimi_fail", ctx({ research: { opportunityCount: 0, retryCount: 3 } }));
    expect(out).toMatchObject({ ok: true });
    if (out.ok) expect(out.resolvedTo).toBe("BLOCKED");
  });

  it("RESEARCHING + kimi_fail + retryCount=0 → GUARD_FAILED (masih ada kesempatan retry)", () => {
    const out = advance("RESEARCHING", "kimi_fail", ctx({ research: { opportunityCount: 0, retryCount: 0 } }));
    expect(out).toMatchObject({ ok: false, code: "GUARD_FAILED" });
  });

  it("EXECUTING + glm_fail + glm.retryCount=3 → BLOCKED (T17); sumber retry = glm, bukan research", () => {
    const out = advance("EXECUTING", "glm_fail", ctx({
      research: { opportunityCount: 1, retryCount: 0 }, // 0 — TIDAK boleh dipakai utk T17
      glm: { retryCount: 3 },
    }));
    expect(out).toMatchObject({ ok: true });
    if (out.ok) expect(out.resolvedTo).toBe("BLOCKED");
  });
});

// ── Fixture helpers ──────────────────────────────────────────────────────────

const OBJ = {
  id: randomUUID(), title: "Profit Rp100jt", market: "Indonesia", riskTolerance: "moderate" as const,
  targetProfit: "100000000.00", capitalApproved: "10000000.00", horizonMonths: 12, environment: "SIMULATED",
};

function ranked(id: string, name = "opp", i = 0) {
  return {
    id, name, riskAdjustedScore: (9 - i).toFixed(2), capitalRequired: "800000.00",
    expectedValue: (2_000_000 - i * 100_000).toFixed(2),
  };
}

let MISSION_UUID = "00000000-0000-4000-8000-000000000001";
let EXECUTION_UUID = "00000000-0000-4000-8000-000000000002";

function missionPkg() {
  MISSION_UUID = randomUUID();
  EXECUTION_UUID = randomUUID();
  return MissionPackageSchema.parse({
    mission_id: MISSION_UUID, mission_version: 1, objective: "o", strategic_goal: "g",
    business_context: "c", target_customer: "t", customer_problem: "p", value_proposition: "v",
    product_or_service: "s", business_model: "m", pricing: "p",
    expected_economics: { revenue_target: "1.00", cost_estimate: "1.00", expected_profit: "1.00", assumptions: [] },
    strategic_rationale: "r", priority: 3,
    tasks: [{ task_id: "T-1", title: "x", depends_on: [] }],
    technical_requirements: [], data_requirements: [], api_requirements: [], architecture_requirements: [],
    ui_requirements: [], automation_requirements: [], security_requirements: [], deployment_requirements: [],
    analytics_requirements: [], operational_requirements: [],
    budget: "1000.00", time_limit: { hard_deadline_hours: 24 },
    hard_constraints: [], soft_constraints: [], acceptance_criteria: ["a"],
    test_requirements: [], success_metrics: ["revenue"],
    success_thresholds: { revenue: "1.0000" }, failure_thresholds: { revenue: "0.0000" },
    kill_criteria: ["k"], scale_criteria: ["s"], deliverables: ["d"],
    reporting_requirements: [], escalation_conditions: [],
  });
}

function validGlmResult(): GlmResult {
  const r = GlmResultSchema.parse({
    mission_id: MISSION_UUID,
    mission_version: 1,
    execution_id: EXECUTION_UUID,
    status: "SUCCEEDED", objective_status: "ON_TRACK", summary: "ok",
    work: { completed: [], files_created: [], files_modified: [], files_deleted: [], systems_changed: [] },
    verification: { tests_run: 0, test_results: { passed: 0, failed: 0 }, build_result: "PASS", deployment_result: "OK", runtime_result: "OK" },
    business_metrics: { traffic: 0, leads: 0, customers: 0, conversions: 0, revenue: "0.00", cost: "0.00", profit: "0.00", cac: "0.00", retention: 0 },
    signals: { observed_market_signal: "-", customer_signal: "-" },
    errors: [], blockers: [], assumptions: [], unverified_items: [],
    recommendation: "CONTINUE", evidence: [],
  });
  return r;
}

function ctx(over: Partial<GuardContext> = {}): GuardContext {
  return {
    state: "RESEARCHING",
    now: new Date("2027-01-01T00:00:00Z"),
    objective: {
      id: OBJ.id, deadline: "2027-06-01", capitalApproved: OBJ.capitalApproved,
      horizonMonths: 12, autonomyLevel: 1, riskTolerance: "moderate",
    },
    ...over,
  } as GuardContext;
}
