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

export type ObjectiveDetail = {
  id: string; title: string; status: string; stage: string;
  industry: string | null; business_mode: string; progress: number;
  environment: string;
  business: BusinessVenture | null;
  economics: Economics | null;
  strategy: Strategy | null;
  execution: Execution | null;
  result: Result | null;
  decision: Decision | null;
  events: AeeEvent[];
};

export type OppSummary = {
  id: string; name: string; status: string;
  customer_segment: string; problem: string; solution: string;
  business_model: string; capital_required: string | null;
  expected_revenue: string | null; risk_score: number | null;
  risk_adjusted_score: number | null;
};

export type AeeEvent = {
  id?: string; event_type: string; type?: string;
  created_at: string; stage: string; message?: string;
  payload?: Record<string, unknown> | null;
};

export type Approval = {
  id: string; decision_type: string; stage: string;
  status: string; version: number; payload?: Record<string, unknown> | null;
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
  const snap = raw.snapshot || obj.snapshot;
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
    business: biz || null,
    economics: snap ? {
      revenue_target: snap.revenue ? Number(snap.revenue) : undefined,
      operating_profit: snap.operating_profit ? Number(snap.operating_profit) : undefined,
      roi: snap.roi,
    } : (raw.economics || null),
    strategy: raw.strategy || null,
    execution: raw.execution || null,
    result: raw.result || null,
    decision: dec ? {
      recommendation: dec.decision || dec.recommendation,
      confidence: dec.confidence,
      rationale: dec.reason || dec.rationale,
    } : null,
    events: [],
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

export async function listApprovals(objectiveId: string): Promise<Approval[]> {
  try {
    const res = await api<{ approvals: any[] }>("GET", `/approvals?objective_id=${objectiveId}`);
    return (res.approvals || []).map(a => ({
      id: a.id,
      decision_type: a.category || a.kind || a.decision_type || "UNKNOWN",
      stage: a.resume_state || a.stage || "UNKNOWN",
      status: a.status || "PENDING",
      version: 0,
      payload: a.payload || null,
    }));
  } catch { return []; }
}

export async function approveDecision(approvalId: string): Promise<void> {
  await api("POST", `/approvals/${approvalId}/approve`, { version: 0 }, { "idempotency-key": idemKey("ap") });
}

export async function rejectDecision(approvalId: string, reason = "dashboard"): Promise<void> {
  await api("POST", `/approvals/${approvalId}/reject`, { reason }, { "idempotency-key": idemKey("rj") });
}

export async function listEvents(objectiveId: string): Promise<AeeEvent[]> {
  try {
    const res = await api<{ events: any[] }>("GET", `/events?objective_id=${objectiveId}`);
    return (res.events || []).map(e => ({
      id: e.id,
      event_type: e.event_type || e.type || "UNKNOWN",
      created_at: e.created_at,
      stage: e.stage || (e.payload?.stage as string) || "—",
      message: e.message || (e.payload?.message as string) || (typeof e.payload === "string" ? e.payload : undefined),
      payload: e.payload || null,
    }));
  } catch { return []; }
}

export async function listOpportunities(objectiveId: string): Promise<OppSummary[]> {
  try {
    const res = await api<{ opportunities: any[] }>(`GET`, `/objectives/${objectiveId}/opportunities`);
    return (res.opportunities || []).map(o => ({
      id: o.id,
      name: o.name || "—",
      status: o.status || "UNKNOWN",
      customer_segment: o.customer_segment || "—",
      problem: o.problem || "—",
      solution: o.solution || "—",
      business_model: o.business_model || "—",
      capital_required: o.capital_required || null,
      expected_revenue: o.revenue_potential || null,
      risk_score: o.risk_score ?? null,
      risk_adjusted_score: o.risk_adjusted_score ?? null,
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
export async function listExperiments(objectiveId: string): Promise<any> {
  return api("GET", `/objectives/${objectiveId}/experiments`);
}
export async function listMissions(objectiveId: string): Promise<any> {
  return api("GET", `/objectives/${objectiveId}/missions`);
}
export async function listResults(objectiveId: string): Promise<any> {
  return api("GET", `/objectives/${objectiveId}/results`);
}
export async function getEconomics(objectiveId: string): Promise<any> {
  return api("GET", `/objectives/${objectiveId}/economics`);
}
export async function listDecisions(objectiveId: string): Promise<{ decisions: any[] }> {
  return api("GET", `/decisions?objective_id=${objectiveId}`);
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
