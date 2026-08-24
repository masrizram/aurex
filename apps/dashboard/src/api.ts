// API + types for the AEE dashboard — McKinsey design system.
// All functions accept userId for the x-user-id header.

export type AgentMode = {
  mode: "REAL" | "MOCK";
  kimi: { model: string };
  glm: { model: string };
};

export type BusinessVenture = {
  id: string; name: string; industry: string; market: string;
  target_customer: string; problem: string; solution: string;
  business_model: string; price?: number; origin: string;
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
  if (/ECONNREFUSED|fetch failed/i.test(msg)) return "Server tidak terhubung — periksa koneksi database";
  if (/500/.test(msg)) return "Server error — periksa koneksi database";
  if (/503/.test(msg)) return "Service unavailable";
  if (/429/.test(msg)) return "Rate limited — coba lagi sebentar";
  if (/404/.test(msg)) return "Not found";
  if (/401|403/.test(msg)) return "Akses ditolak";
  return msg;
}

// ── Core fetch wrapper ──
async function api<T>(method: string, path: string, userId: string, body?: unknown, hdr?: Record<string, string>): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      "content-type": "application/json",
      "x-user-id": userId,
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
export async function getMode(userId: string): Promise<AgentMode> {
  return api<AgentMode>("GET", "/agent-mode", userId);
}

export async function listObjectives(userId: string): Promise<ObjectiveListItem[]> {
  const res = await api<{ objectives: any[] }>("GET", "/objectives", userId);
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

export async function getObjectiveDetail(id: string, userId: string): Promise<ObjectiveDetail> {
  const raw = await api<any>("GET", `/objectives/${id}`, userId);
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

export async function createObjective(body: Record<string, unknown>, userId: string): Promise<CreateResult> {
  return api<CreateResult>("POST", "/objectives", userId, body, { "idempotency-key": idemKey("obj") });
}

export async function startObjective(id: string, userId: string): Promise<{ cycle_id: string }> {
  return api<{ cycle_id: string }>("POST", `/objectives/${id}/start`, userId, {}, { "idempotency-key": idemKey("start") });
}

export async function listApprovals(objectiveId: string, userId: string): Promise<Approval[]> {
  try {
    const res = await api<{ approvals: any[] }>("GET", `/approvals?objective_id=${objectiveId}`, userId);
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

export async function approveDecision(approvalId: string, userId: string): Promise<void> {
  await api("POST", `/approvals/${approvalId}/approve`, userId, { version: 0 }, { "idempotency-key": idemKey("ap") });
}

export async function rejectDecision(approvalId: string, userId: string): Promise<void> {
  await api("POST", `/approvals/${approvalId}/reject`, userId, { reason: "dashboard" }, { "idempotency-key": idemKey("rj") });
}

export async function listEvents(objectiveId: string, userId: string): Promise<AeeEvent[]> {
  try {
    const res = await api<{ events: any[] }>("GET", `/events?objective_id=${objectiveId}`, userId);
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

export async function listOpportunities(objectiveId: string, userId: string): Promise<OppSummary[]> {
  try {
    const res = await api<{ opportunities: any[] }>(`GET`, `/objectives/${objectiveId}/opportunities`, userId);
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

// ── Admin API ──────────────────────────────────────────────────────────────────

// ── Auth lifecycle §6 ──
export async function verifyEmail(token: string): Promise<{ ok: boolean }> {
  return api("POST", "/auth/verify-email", "", { token });
}
export async function forgotPassword(email: string): Promise<{ ok: boolean }> {
  return api("POST", "/auth/forgot-password", "", { email });
}
export async function resetPassword(token: string, password: string): Promise<{ ok: boolean }> {
  return api("POST", "/auth/reset-password", "", { token, password });
}

// ── Opportunity actions §19 ──
export async function selectOpportunity(objectiveId: string, oppId: string, reason?: string, userId = ""): Promise<{ queued: boolean }> {
  return api("POST", `/objectives/${objectiveId}/opportunities/${oppId}/select`, userId, { reason });
}
export async function letAurexDecide(objectiveId: string, userId = ""): Promise<{ queued: boolean }> {
  return api("POST", `/objectives/${objectiveId}/opportunities/let-aurex-decide`, userId, {});
}
export async function rejectOpportunity(objectiveId: string, oppId: string, reason?: string, userId = ""): Promise<{ rejected: boolean }> {
  return api("POST", `/objectives/${objectiveId}/opportunities/${oppId}/reject`, userId, { reason });
}
export async function saveOpportunity(objectiveId: string, oppId: string, note?: string, userId = ""): Promise<{ saved: boolean }> {
  return api("POST", `/objectives/${objectiveId}/opportunities/${oppId}/save`, userId, { note });
}

// ── Product layer §20-27 ──
export async function listExperiments(objectiveId: string, userId = ""): Promise<any> {
  return api("GET", `/objectives/${objectiveId}/experiments`, userId);
}
export async function listMissions(objectiveId: string, userId = ""): Promise<any> {
  return api("GET", `/objectives/${objectiveId}/missions`, userId);
}
export async function listResults(objectiveId: string, userId = ""): Promise<any> {
  return api("GET", `/objectives/${objectiveId}/results`, userId);
}
export async function getEconomics(objectiveId: string, userId = ""): Promise<any> {
  return api("GET", `/objectives/${objectiveId}/economics`, userId);
}
export async function listDecisions(objectiveId: string, userId = ""): Promise<{ decisions: any[] }> {
  return api("GET", `/decisions?objective_id=${objectiveId}`, userId);
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
