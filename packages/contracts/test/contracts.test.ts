import { describe, expect, it } from "vitest";
import {
  CreateObjectiveRequestSchema, DecisionRecordSchema, GlmResultSchema,
  determineTier, intakeResult, type GlmResult,
} from "@aee/contracts";

const UUID = "11111111-1111-1111-1111-111111111111";
const SHA = "a".repeat(64);

const validDecision = {
  decision: "ITERATE",
  subject_id: UUID,
  reason: "Uji coba integrasi menunjukkan konversi naik konsisten lintas tiga siklus pengukuran berturut-turut.",
  evidence_ids: [UUID],
  metrics: { revenue: 0, cac: 0, conversion: 0 },
  assumptions: ["Retensi 30 hari stabil"],
  confidence: 0.62,
  expected_value_next: "1800000.00",
};

const validGlm: GlmResult = {
  mission_id: UUID,
  mission_version: 1,
  execution_id: UUID,
  status: "SUCCEEDED",
  objective_status: "ON_TRACK",
  summary: "Landing page live dengan 3 varian.",
  work: { completed: ["t1", "t2"], files_created: ["a.ts"], files_modified: [], files_deleted: [], systems_changed: ["vercel"] },
  verification: {
    tests_run: 12, test_results: { passed: 12, failed: 0 },
    build_result: "PASS", deployment_result: "PASS", runtime_result: "PASS",
  },
  business_metrics: {
    traffic: 1000, leads: 40, customers: 4, conversions: 4,
    revenue: "250000.00", cost: "50000.00", profit: "200000.00",
    cac: "12500.00", retention: 0.5,
  },
  signals: { observed_market_signal: "permintaan naik", customer_signal: "feedback positif" },
  errors: [], blockers: [], assumptions: ["CTR 4%"], unverified_items: [],
  recommendation: "CONTINUE",
  evidence: [{ kind: "metric", uri: "metric://revenue", sha256: SHA }],
};

describe("§9 DecisionRecord (Kimi)", () => {
  it("objek valid diterima", () => {
    expect(DecisionRecordSchema.safeParse(validDecision).success).toBe(true);
  });
  it("evidence kosong DITOLAK (GAP-05)", () => {
    const bad = { ...validDecision, evidence_ids: [] };
    expect(DecisionRecordSchema.safeParse(bad).success).toBe(false);
  });
  it("reason < 50 karakter DITOLAK", () => {
    const bad = { ...validDecision, reason: "terlalu singkat" };
    expect(DecisionRecordSchema.safeParse(bad).success).toBe(false);
  });
  it("confidence di luar [0,1] DITOLAK", () => {
    expect(DecisionRecordSchema.safeParse({ ...validDecision, confidence: 1.5 }).success).toBe(false);
  });
  it("angka finansial sebagai FLOAT (bukan string) DITOLAK — D5", () => {
    expect(DecisionRecordSchema.safeParse({ ...validDecision, expected_value_next: 1800000 }).success).toBe(false);
  });
  it("field tak dikenal DITOLAK (strict)", () => {
    const bad = { ...validDecision, sneaky: "injection" };
    expect(DecisionRecordSchema.safeParse(bad).success).toBe(false);
  });
});

describe("§10 GlmResult (GLM)", () => {
  it("objek valid diterima", () => {
    expect(GlmResultSchema.safeParse(validGlm).success).toBe(true);
  });
  it("field tak dikenal DITOLAK (RESULT_REJECTED)", () => {
    const bad = { ...validGlm, hallucinated_field: true };
    expect(GlmResultSchema.safeParse(bad).success).toBe(false);
  });
  it("status di luar enumerasi DITOLAK", () => {
    expect(GlmResultSchema.safeParse({ ...validGlm, status: "MOSTLY_SUCCEEDED" }).success).toBe(false);
  });
  it("sha256 bukan hex-64 DITOLAK", () => {
    const bad = { ...validGlm, evidence: [{ kind: "url", uri: "https://x", sha256: "zz" }] };
    expect(GlmResultSchema.safeParse(bad).success).toBe(false);
  });
  it("revenue float DITOLAK — wajib string NUMERIC(20,2)", () => {
    expect(GlmResultSchema.safeParse({ ...validGlm, business_metrics: { ...validGlm.business_metrics, revenue: 250000 } }).success).toBe(false);
  });
});

describe("determineTier (§10 aturan 3 — anti sukses palsu)", () => {
  it("revenue>0 TANPA evidence → SELF_REPORTED, ledgerWritten=false", () => {
    const r = { ...validGlm, evidence: [] };
    const t = determineTier(r);
    expect(t.tier).toBe("SELF_REPORTED");
    expect(t.ledgerWritten).toBe(false);
  });
  it("revenue>0 DENGAN evidence sha → EVIDENCED (tetap bukan RECONCILED)", () => {
    const t = determineTier(validGlm);
    expect(t.tier).toBe("EVIDENCED");
    expect(t.ledgerWritten).toBe(false);
  });
  it("revenue=0 → SELF_REPORTED", () => {
    const r = { ...validGlm, business_metrics: { ...validGlm.business_metrics, revenue: "0.00" } };
    expect(determineTier(r).tier).toBe("SELF_REPORTED");
  });
});

describe("intakeResult (§10 aturan 1–2)", () => {
  const execOk = { missionId: UUID, missionVersion: 1, executionId: UUID, status: "RUNNING" };

  it("hasil cocok execution RUNNING → accepted", () => {
    const out = intakeResult({ result: validGlm, execution: execOk });
    expect(out.accepted).toBe(true);
    if (out.accepted) {
      expect(out.verificationTier).toBe("EVIDENCED");
      expect(out.ledgerWritten).toBe(false);
      expect(out.partial).toBe(false);
    }
  });
  it("referensi tak cocok → RESULT_REJECTED (anti halusinasi referensi)", () => {
    const out = intakeResult({ result: validGlm, execution: { ...execOk, executionId: "22222222-2222-2222-2222-222222222222" } });
    expect(out.accepted).toBe(false);
  });
  it("execution tidak RUNNING → RESULT_REJECTED (anti duplikat)", () => {
    const out = intakeResult({ result: validGlm, execution: { ...execOk, status: "SUCCEEDED" } });
    expect(out.accepted).toBe(false);
  });
  it("PARTIAL diterima dengan flag", () => {
    const partial = { ...validGlm, status: "PARTIAL" as const };
    const out = intakeResult({ result: partial, execution: execOk });
    expect(out.accepted).toBe(true);
    if (out.accepted) expect(out.partial).toBe(true);
  });
});

describe("§8 CreateObjectiveRequest", () => {
  const ok = {
    title: "Rp100jt profit 12 bulan",
    target_profit: "100000000.00",
    capital_approved: "10000000.00",
    horizon_months: 12,
    market: "Indonesia",
    risk_tolerance: "moderate",
  };
  it("valid diterima", () => {
    expect(CreateObjectiveRequestSchema.safeParse(ok).success).toBe(true);
  });
  it("target_profit ≤ 0 DITOLAK (CHECK DB juga)", () => {
    expect(CreateObjectiveRequestSchema.safeParse({ ...ok, target_profit: "0.00" }).success).toBe(false);
  });
  it("horizon 61 bulan DITOLAK (BETWEEN 1 AND 60)", () => {
    expect(CreateObjectiveRequestSchema.safeParse({ ...ok, horizon_months: 61 }).success).toBe(false);
  });
  it("autonomy_level 5 DITOLAK (0–4)", () => {
    expect(CreateObjectiveRequestSchema.safeParse({ ...ok, autonomy_level: 5 }).success).toBe(false);
  });
});
