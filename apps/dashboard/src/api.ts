// AUREX API client — cookie-session based (production contract).
// x-user-id header hanya valid di dev-mode backend; UI ini cookie-first.
// Types retained from the AEE dashboard; mapping helpers preserved.

export type AgentMode = {
  mode: "REAL" | "MOCK";
  kimi: { model: string };
  glm: { model: string };
};

export type BusinessVenture = {
  id: string; name: string; industry: string; market: string;
  target_customer: string; problem: string; solution: string;
  business_model: string; price?: number; origin: string;
  objective_count?: number; created_at?: string;
};

export type ObjectiveListItem = {
  id: string; title: string; status: string; stage: string;
  industry: string | null; business_mode: string; progress: number;
  business_name: string | null;
};

export type Economics = {
  revenue_target?: number; unit_price?: number; unit_cost?: number;
  gross_margin?: number; operating_profit?: number; roi?: number;
  break_even_units?: number;
};

export type Strategy = {
  positioning?: string; differentiation?: string;
  go_to_market?: string; competitive_edge?: string;
};

export type Execution = {
  timeline?: string; milestones?: string; resources?: string; risks?: string;
};

export type Result = {
  projected_revenue?: number; actual_revenue?: number;
  projected_customers?: number; actual_customers?: number;
  projected_profit?: number; actual_profit?: number;
};

export type Decision = {
  recommendation?: string; confidence?: number; rationale?: string;
};

export type VerifiedValue = { revenue: string; cost: string };

export type LifecycleCounts = {
  opportunities: number; experiments: number; missions: number;
  decisions: number; results: number; approvals_pending: number;
};

export type ObjectiveDetail = {
  id: string; title: string; status: string; stage: string;
  industry: string | null; business_mode: string; progress: number;
  environment: string;
  goal_type?: string | null;
  created_at?: string | null; deadline?: string | null;
  horizon_months?: number | null; target_profit?: string | null;
  capital_approved?: string | null; autonomy_level?: number | null;
  current_cycle?: number | null;
  business: BusinessVenture | null;
  economics: Economics | null;
  strategy: Strategy | null;
  execution: Execution | null;
  result: Result | null;
  decision: Decision | null;
  /** Snapshot ledger terbaru (turunan — bukan klaim LLM). */
  snapshot: {
    revenue?: string; cogs?: string; gross_profit?: string; gross_margin?: string;
    opex?: string; operating_profit?: string; capital_deployed?: string;
    capital_remaining?: string; drawdown?: string; roi?: string; created_at?: string;
  } | null;
  /** Nilai TERVERIFIKASI: hanya ledger RECONCILED (bukti pembayaran). */
  verified: VerifiedValue;
  counts: LifecycleCounts;
};

// ── Opportunity penuh (§6): skor komposit engine eksplisit ──
export type OppSummary = {
  id: string; name: string; status: string;
  customer_segment: string; problem: string; solution: string;
  business_model: string;
  price: string | null; revenue_potential: string | null;
  cost_estimate: string | null; margin: string | null;
  capital_required: string | null; time_to_revenue_days: number | null;
  demand_score: number | null; willingness_to_pay_score: number | null;
  profitability_score: number | null; scalability_score: number | null;
  defensibility_score: number | null; execution_feasibility_score: number | null;
  evidence_strength_score: number | null; time_to_revenue_score: number | null;
  risk_score: number | null; opportunity_score: number | null;
  risk_adjusted_score: number | null; probability_of_success: string | null;
  expected_value: string | null;
  assumptions: unknown[]; unknowns: unknown[];
};

// ── Experiment / Mission / Result / Economics row (§7/§10/§12/§14) ──
export type ExperimentRow = {
  id: string; hypothesis: string | null; objective: string | null;
  budget: string | null; spent: string | null; duration_days: number | null;
  success_metric: string | null; success_threshold: string | null;
  failure_threshold: string | null; kill_criteria: unknown;
  scale_criteria: unknown; information_gain_target: number | null;
  status: string; result: unknown; measured_value: string | null;
  created_at: string; opportunity_name: string | null;
};

export type MissionRow = {
  id: string; status: string; priority: string | null;
  created_at: string; version: number | null;
  package: Record<string, unknown> | null; package_hash: string | null;
  opportunity_name: string | null; execution_count: number;
};

export type ResultRow = {
  id: string; verification_tier: string;
  revenue_claimed: string | null; cost_claimed: string | null;
  payload: Record<string, unknown> | null; created_at: string;
  execution_status: string | null; provider?: string | null; attempt?: number | null;
  started_at?: string | null; finished_at?: string | null;
  mission_id: string | null; opportunity_name: string | null;
};

export type EconomicsSnapshotRow = {
  revenue: string | null; cogs: string | null; gross_profit: string | null;
  gross_margin: string | null; opex: string | null; operating_profit: string | null;
  capital_deployed: string | null; capital_remaining: string | null;
  drawdown: string | null; roi: string | null; created_at: string | null;
};

export type EconomicsPayload = {
  snapshots: EconomicsSnapshotRow[];
  target: { target_profit: string; capital_approved: string } | null;
  baseline: EconomicsSnapshotRow | null;
  current: EconomicsSnapshotRow | null;
  verified: VerifiedValue;
};

export type DecisionRow = {
  id: string; decision: string; reason: string | null;
  confidence: string | null; evidence_ids: unknown;
  decided_by: string | null; created_at: string;
};

// ── GET /overview payload (§2 Economic Control Center) ──
export type OverviewScoreboard = {
  objectives_total: number; objectives_active: number;
  revenue: number; cogs: number; gross_profit: number;
  gross_margin: number | null; operating_profit: number;
  capital_approved: number; capital_deployed: number; capital_remaining: number;
  portfolio_roi: number | null;
  verified_revenue: number; verified_cost: number;
};

export type OverviewTrajectoryPoint = {
  objective_id: string; objective_title: string;
  revenue: string; cogs: string; gross_profit: string; gross_margin: string | null;
  opex: string; operating_profit: string; capital_deployed: string;
  capital_remaining: string; drawdown: string; roi: string | null; created_at: string;
};

export type OverviewAttention = {
  pending_approvals: Approval[];
  blocked_objectives: { id: string; title: string; state: string }[];
  failed_executions: {
    id: string; status: string; objective_id: string;
    finished_at: string | null; mission_title: string | null; objective_title: string;
  }[];
};

export type OverviewCounts = {
  experiments_by_status: { status: string; count: number }[];
  experiments_total: number;
  decisions_by_type: { decision: string; count: number }[];
  decisions_total: number;
  missions_by_status: { status: string; count: number }[];
  missions_total: number;
};

export type OverviewPayload = {
  scoreboard: OverviewScoreboard;
  trajectory: OverviewTrajectoryPoint[];
  attention: OverviewAttention;
  counts: OverviewCounts;
  events: {
    id: string; objective_id: string; event_type: string;
    payload: Record<string, unknown> | null; created_at: string;
    objective_title: string;
  }[];
};

export async function getOverview(): Promise<OverviewPayload> {
  return api<OverviewPayload>("GET", "/overview");
}

// ── AI accountability §17 — agregasi tabel model_runs (jejak run nyata) ──
export type AiEconomicsRow = {
  agent: string; purpose: string; runs: number;
  succeeded: number; failed: number;
  input_tokens: string; output_tokens: string;
  cost: string | null; avg_latency_ms: number;
};

export async function getAiEconomics(): Promise<{ by_agent_purpose: AiEconomicsRow[] }> {
  return api("GET", "/ai-economics");
}

// ── Forecast §15 — skenario BEAR/BASE/BULL dari snapshot terbaru ────────────
// Semua angka PROJECTED (bukan verified) — kalkulasi deterministik di BE.
export type ForecastRow = {
  name: "BEAR" | "BASE" | "BULL";
  revenueDelta: string; projectedMonthlyRevenue: string;
  projectedMonthlyProfit: string; projectedTotalProfit: string;
  probability: string;
};

export type ForecastPayload = {
  horizonMonths: number;
  scenarios: readonly ForecastRow[];
  probabilityWeightedEV: string;
  paybackMonths: number | null;
};

export async function getForecast(objectiveId: string, horizon = 3): Promise<ForecastPayload> {
  return api("GET", `/objectives/${objectiveId}/forecast?horizon=${horizon}`);
}

// ── Billing checkout Duitku — buat invoice & arahkan ke payment URL ─────────
export type CheckoutResponse = { order_id: string; payment_url: string; reference: string };

export async function startCheckout(planTier: string, periodMonths: number): Promise<CheckoutResponse> {
  return api("POST", "/billing/checkout", { plan_tier: planTier, period_months: periodMonths });
}

export type AeeEvent = {
  id?: string; event_type: string; type?: string;
  created_at: string; stage: string; message?: string;
  payload?: Record<string, unknown> | null;
  objective_id?: string; objective_title?: string;
};

export type Approval = {
  id: string; objective_id?: string; category: string; status: string;
  resume_state?: string | null;
  payload?: Record<string, unknown> | null;
  // Decision pack (§11): kolom asli tabel approvals
  why_required?: string | null; what_will_happen?: string | null;
  capital_at_risk?: string | null; expected_upside?: string | null;
  expected_downside?: string | null; expires_at?: string | null;
  decided_by?: string | null; decided_at?: string | null; created_at?: string | null;
  objective_title?: string | null;
};

export type CreateResult = { id: string; objective?: { id: string } };

// ── Error parsing ──
export function parseApiError(e: unknown): string {
  const msg = (e as Error)?.message || String(e);
  try {
    // Try parsing JSON error envelope: {"error":{"code":"...","message":"..."}}
    const j = JSON.parse(msg);
    const m = j?.error?.message ?? j?.message ?? j?.error;
    if (typeof m === "string" && m.length > 0) return m;
  } catch { /* not JSON */ }
  if (/ECONNREFUSED|fetch failed|Failed to fetch/i.test(msg)) return "Tidak dapat terhubung ke server AUREX. Periksa koneksi Anda.";
  if (/500/.test(msg)) return "AUREX tidak dapat menyelesaikan permintaan ini. Data Anda aman.";
  if (/503/.test(msg)) return "Service unavailable";
  if (/429/.test(msg)) return "Terlalu banyak permintaan — coba lagi sebentar.";
  if (/404/.test(msg)) return "Tidak ditemukan";
  if (/401|403/.test(msg)) return "Akses ditolak";
  return msg;
}

// ── Core fetch wrapper (cookie session; same-origin) ──
async function api<T>(method: string, path: string, body?: unknown, hdr?: Record<string, string>): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(hdr || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => res.statusText);
    throw new Error(t || `HTTP ${res.status}`);
  }
  const text = await res.text();
  if (!text) return undefined as unknown as T;
  return JSON.parse(text) as T;
}

let idemCounter = 0;
function idemKey(prefix: string): string {
  idemCounter++;
  return `${prefix}-${Date.now()}-${idemCounter}`;
}

// ── API functions ──
export async function getMode(): Promise<AgentMode> {
  return api<AgentMode>("GET", "/agent-mode");
}

export async function listVentures(): Promise<{ ventures: BusinessVenture[] }> {
  return api<{ ventures: BusinessVenture[] }>("GET", "/ventures");
}

export async function listObjectives(): Promise<ObjectiveListItem[]> {
  const res = await api<{ objectives: any[] }>("GET", "/objectives");
  return (res.objectives || []).map(mapListItem);
}

function mapListItem(raw: any): ObjectiveListItem {
  return {
    id: raw.id,
    title: raw.title || raw.objective_name || "Untitled",
    status: raw.status || raw.state || "UNKNOWN",
    stage: raw.stage || raw.state || "UNKNOWN",
    industry: raw.business_industry || raw.industry || null,
    business_mode: raw.business_mode || "DISCOVERY",
    progress: typeof raw.progress === "number" ? raw.progress : 0,
    business_name: raw.business_name || null,
  };
}

export async function getObjectiveDetail(id: string): Promise<ObjectiveDetail> {
  const raw = await api<any>("GET", `/objectives/${id}`);
  return mapDetail(raw);
}

function mapDetail(raw: any): ObjectiveDetail {
  const obj = raw.objective || raw;
  const snap = raw.snapshot ?? obj.snapshot ?? null;
  const biz = raw.business || obj.business;
  const dec = raw.last_decision || obj.last_decision || raw.decision;
  return {
    id: obj.id,
    title: obj.title || obj.objective_name || "Untitled",
    status: obj.status || obj.state || "UNKNOWN",
    stage: obj.stage || obj.state || "UNKNOWN",
    industry: biz?.industry || obj.industry || null,
    business_mode: obj.business_mode || "DISCOVERY",
    progress: typeof obj.progress === "number" ? obj.progress : 0,
    environment: obj.environment || "SIMULATED",
    goal_type: obj.goal_type ?? null,
    created_at: obj.created_at ?? null,
    deadline: obj.deadline ?? null,
    horizon_months: obj.horizon_months ?? null,
    target_profit: obj.target_profit ?? null,
    capital_approved: obj.capital_approved ?? null,
    autonomy_level: obj.autonomy_level ?? null,
    current_cycle: obj.current_cycle ?? null,
    business: biz || null,
    economics: snap ? {
      revenue_target: snap.revenue ? Number(snap.revenue) : undefined,
      operating_profit: snap.operating_profit != null && snap.operating_profit !== ""
        ? Number(snap.operating_profit) : undefined,
      roi: snap.roi != null && snap.roi !== "" ? Number(snap.roi) : undefined,
      gross_margin: snap.gross_margin != null && snap.gross_margin !== ""
        ? Number(snap.gross_margin) : undefined,
    } : (raw.economics || null),
    strategy: raw.strategy || null,
    execution: raw.execution || null,
    result: raw.result || null,
    decision: dec ? {
      recommendation: dec.decision || dec.recommendation,
      confidence: dec.confidence != null && dec.confidence !== "" ? Number(dec.confidence) : undefined,
      rationale: dec.reason || dec.rationale,
    } : null,
    snapshot: snap ? {
      revenue: snap.revenue ?? undefined,
      cogs: snap.cogs ?? undefined,
      gross_profit: snap.gross_profit ?? undefined,
      gross_margin: snap.gross_margin ?? undefined,
      opex: snap.opex ?? undefined,
      operating_profit: snap.operating_profit ?? undefined,
      capital_deployed: snap.capital_deployed ?? undefined,
      capital_remaining: snap.capital_remaining ?? undefined,
      drawdown: snap.drawdown ?? undefined,
      roi: snap.roi ?? undefined,
      created_at: snap.created_at ?? undefined,
    } : null,
    verified: raw.verified ?? { revenue: "0", cost: "0" },
    counts: raw.counts ?? {
      opportunities: 0, experiments: 0, missions: 0,
      decisions: 0, results: 0, approvals_pending: 0,
    },
  };
}

export async function createObjective(body: Record<string, unknown>): Promise<CreateResult> {
  return api<CreateResult>("POST", "/objectives", body, { "idempotency-key": idemKey("obj") });
}

export async function startObjective(id: string): Promise<{ cycle_id: string }> {
  return api<{ cycle_id: string }>("POST", `/objectives/${id}/start`, {}, { "idempotency-key": idemKey("start") });
}

export async function stopObjective(id: string, reason: string): Promise<unknown> {
  return api("POST", `/objectives/${id}/stop`, { reason }, { "idempotency-key": idemKey("stop") });
}

export async function listApprovals(objectiveId?: string): Promise<Approval[]> {
  try {
    const path = objectiveId ? `/approvals?objective_id=${encodeURIComponent(objectiveId)}` : "/approvals";
    const res = await api<{ approvals: any[] }>("GET", path);
    return (res.approvals || []).map((a) => ({
      id: a.id,
      objective_id: a.objective_id ?? undefined,
      category: a.category || "UNKNOWN",
      status: a.status || "PENDING",
      resume_state: a.resume_state ?? null,
      payload: a.payload || null,
      why_required: a.why_required ?? null,
      what_will_happen: a.what_will_happen ?? null,
      capital_at_risk: a.capital_at_risk ?? null,
      expected_upside: a.expected_upside ?? null,
      expected_downside: a.expected_downside ?? null,
      expires_at: a.expires_at ?? null,
      decided_by: a.decided_by ?? null,
      decided_at: a.decided_at ?? null,
      created_at: a.created_at ?? null,
      objective_title: a.objective_title ?? null,
    }));
  } catch { return []; }
}

export async function approveDecision(approvalId: string, note?: string): Promise<void> {
  // Backend ApprovalNoteSchema .strict({note}) — version TIDAK ada di kontrak
  // (approve pakai transisi status + optimistic FSM, bukan row version).
  await api("POST", `/approvals/${approvalId}/approve`, note ? { note } : {});
}

export async function rejectDecision(approvalId: string, reason = "dashboard"): Promise<void> {
  await api("POST", `/approvals/${approvalId}/reject`, { reason }, { "idempotency-key": idemKey("rj") });
}

export async function listEvents(objectiveId?: string): Promise<AeeEvent[]> {
  try {
    const path = objectiveId ? `/events?objective_id=${encodeURIComponent(objectiveId)}` : "/events";
    const res = await api<{ events: any[] }>("GET", path);
    return (res.events || []).map(e => ({
      id: e.id,
      event_type: e.event_type || e.type || "UNKNOWN",
      created_at: e.created_at,
      stage: e.stage || (e.payload?.stage as string) || "—",
      message: e.message || (e.payload?.message as string) || (typeof e.payload === "string" ? e.payload : undefined),
      payload: e.payload || null,
      objective_id: e.objective_id ?? undefined,
      objective_title: e.objective_title ?? undefined,
    }));
  } catch { return []; }
}

export async function listOpportunities(objectiveId: string): Promise<OppSummary[]> {
  try {
    const res = await api<{ opportunities: any[] }>(`GET`, `/objectives/${encodeURIComponent(objectiveId)}/opportunities`);
    return (res.opportunities || []).map(o => ({
      id: o.id,
      name: o.name || "—",
      status: o.status || "UNKNOWN",
      customer_segment: o.customer_segment || "—",
      problem: o.problem || "—",
      solution: o.solution || "—",
      business_model: o.business_model || "—",
      price: o.price ?? null,
      revenue_potential: o.revenue_potential ?? null,
      cost_estimate: o.cost_estimate ?? null,
      margin: o.margin ?? null,
      capital_required: o.capital_required ?? null,
      time_to_revenue_days: o.time_to_revenue_days ?? null,
      demand_score: o.demand_score ?? null,
      willingness_to_pay_score: o.willingness_to_pay_score ?? null,
      profitability_score: o.profitability_score ?? null,
      scalability_score: o.scalability_score ?? null,
      defensibility_score: o.defensibility_score ?? null,
      execution_feasibility_score: o.execution_feasibility_score ?? null,
      evidence_strength_score: o.evidence_strength_score ?? null,
      time_to_revenue_score: o.time_to_revenue_score ?? null,
      risk_score: o.risk_score ?? null,
      opportunity_score: o.opportunity_score ?? null,
      risk_adjusted_score: o.risk_adjusted_score ?? null,
      probability_of_success: o.probability_of_success ?? null,
      expected_value: o.expected_value ?? null,
      assumptions: Array.isArray(o.assumptions) ? o.assumptions : [],
      unknowns: Array.isArray(o.unknowns) ? o.unknowns : [],
    }));
  } catch { return []; }
}

// ── Auth API (cookie-based, no userId needed) ──────────────────────────────────

export async function signup(email: string, password: string, name?: string, orgName?: string): Promise<{ user: { id: string; email: string; role: string; name: string | null }; org_id: string }> {
  const res = await fetch(`/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, name, org_name: orgName }),
  });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  return JSON.parse(await res.text());
}

export async function login(email: string, password: string): Promise<{ user: { id: string; email: string; role: string; name: string | null } }> {
  const res = await fetch(`/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  return JSON.parse(await res.text());
}

export async function logout(): Promise<void> {
  await fetch(`/auth/logout`, { method: "POST", headers: { "content-type": "application/json" } });
}

export async function getMe(): Promise<{
  user: { id: string; email: string; role: string; isAdmin: boolean; name: string | null; emailVerified: boolean };
  org: { id: string; name: string; slug: string; planTier: string; onboardingStep: number; onboardingCompleted: string | null; autonomyLevel: number } | null;
  usage: { credits_used: number; credits_limit: number } | null;
}> {
  const res = await fetch(`/auth/me`, { headers: { "content-type": "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(await res.text());
}

// ── Onboarding API ─────────────────────────────────────────────────────────────

export async function onboardingStatus(): Promise<{ step: number; completed: string | null }> {
  const res = await fetch(`/onboarding/status`, { headers: { "content-type": "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(await res.text());
}

export async function onboardingStep1(data: { business_name: string; industry: string; website?: string; products?: string; target_customer: string }): Promise<{ venture_id: string | null }> {
  const res = await fetch(`/onboarding/step1`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  return JSON.parse(await res.text());
}

export async function onboardingStep2(goal_type: string): Promise<{ goal_type: string }> {
  const res = await fetch(`/onboarding/step2`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal_type }),
  });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  return JSON.parse(await res.text());
}

export async function onboardingStep3(data: { current_revenue: string; current_cost: string; capital: string; time_horizon_months: number }): Promise<unknown> {
  const res = await fetch(`/onboarding/step3`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  return JSON.parse(await res.text());
}

export async function onboardingStep4(autonomy_level: number): Promise<{ autonomy_level: number }> {
  const res = await fetch(`/onboarding/step4`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ autonomy_level }),
  });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  return JSON.parse(await res.text());
}

export async function onboardingStep5(data: { title: string; target_profit: string }): Promise<{ objective_id: string; started: boolean; detail: string }> {
  const res = await fetch(`/onboarding/step5`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  return JSON.parse(await res.text());
}

// ── Auth lifecycle §6 ──
export async function verifyEmail(token: string): Promise<{ ok: boolean }> {
  return api("POST", "/auth/verify-email", { token });
}
export async function forgotPassword(email: string): Promise<{ ok: boolean }> {
  return api("POST", "/auth/forgot-password", { email });
}
export async function resetPassword(token: string, password: string): Promise<{ ok: boolean }> {
  return api("POST", "/auth/reset-password", { token, password });
}

// ── Opportunity actions §19 ──
export async function selectOpportunity(objectiveId: string, oppId: string, reason?: string): Promise<{ queued: boolean }> {
  return api("POST", `/objectives/${objectiveId}/opportunities/${oppId}/select`, { reason });
}
export async function letAurexDecide(objectiveId: string): Promise<{ queued: boolean }> {
  return api("POST", `/objectives/${objectiveId}/let-aurex-decide`, {});
}
export async function rejectOpportunity(objectiveId: string, oppId: string, reason?: string): Promise<{ rejected: boolean }> {
  return api("POST", `/objectives/${objectiveId}/opportunities/${oppId}/reject`, { reason });
}
export async function saveOpportunity(objectiveId: string, oppId: string, note?: string): Promise<{ saved: boolean }> {
  return api("POST", `/objectives/${objectiveId}/opportunities/${oppId}/save`, { note });
}

// ── Product layer §20-27 ──
export async function listExperiments(objectiveId: string): Promise<{ experiments: ExperimentRow[] }> {
  return api("GET", `/objectives/${encodeURIComponent(objectiveId)}/experiments`);
}
export async function listMissions(objectiveId: string): Promise<{ missions: MissionRow[] }> {
  return api("GET", `/objectives/${encodeURIComponent(objectiveId)}/missions`);
}
export async function listResults(objectiveId: string): Promise<{ results: ResultRow[] }> {
  return api("GET", `/objectives/${encodeURIComponent(objectiveId)}/results`);
}
export async function getEconomics(objectiveId: string): Promise<EconomicsPayload> {
  return api("GET", `/objectives/${encodeURIComponent(objectiveId)}/economics`);
}
export async function listDecisions(objectiveId: string): Promise<{ decisions: DecisionRow[] }> {
  return api("GET", `/decisions?objective_id=${encodeURIComponent(objectiveId)}`);
}

// ── Billing ──
export type BillingPlan = {
  plan: { tier: string; name: string; price_monthly: string; max_ai_credits_monthly: number };
  subscription: { status: string; plan_id: string; current_period_end: string | null } | null;
  usage: { credits_used: number; credits_limit: number };
};

export async function getBillingPlan(): Promise<BillingPlan> {
  return api<BillingPlan>("GET", "/billing/plan");
}

export async function adminOverview(): Promise<{ users: number; orgs: number; objectives: { count: number; state: string }[] }> {
  const res = await fetch(`/admin/overview`, { headers: { "content-type": "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(await res.text());
}

export async function adminUsers(): Promise<{ users: { id: string; email: string; role: string; name: string | null; status: string; is_admin: boolean }[] }> {
  const res = await fetch(`/admin/users`, { headers: { "content-type": "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(await res.text());
}

export async function adminOrgs(): Promise<{ orgs: { id: string; name: string; slug: string; plan_tier: string; member_count: number }[] }> {
  const res = await fetch(`/admin/orgs`, { headers: { "content-type": "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(await res.text());
}

export async function adminObjectives(): Promise<{ objectives: { id: string; title: string; state: string; business_name: string | null }[] }> {
  const res = await fetch(`/admin/objectives`, { headers: { "content-type": "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(await res.text());
}
