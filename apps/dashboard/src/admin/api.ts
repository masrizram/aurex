// AUREX admin API client — cookie-session based (same contract as /app).
// Data teknis (model runs, providers, FSM raw state) hanya untuk isAdmin.
// Semua mutasi admin otomatis tercatat di audit_logs oleh backend.
import { parseApiError } from "@/api";

const BASE = "/admin";

export type AdminOverview = {
  users: number;
  activeUsers: number;
  suspendedUsers: number;
  orgs: number;
  objectives: { count: number; state: string }[];
  providers: number;
  pendingApprovals: number;
  failedExecutions: number;
  orgsByPlan: { tier: string; count: number }[];
};

export type AdminUserRow = {
  id: string; email: string; role: string; name: string | null;
  status: string; is_admin: boolean; created_at: string;
  org_count: number; objective_count: number;
};

export type AdminUserDetail = AdminUserRow & {
  updated_at: string; session_count: number;
  memberships: {
    org_id: string; org_name: string; org_slug: string; role: string; joined_at: string;
  }[] | null;
};

export type AdminOrgRow = {
  id: string; name: string; slug: string; plan_tier: string; status: string;
  member_count: number; objective_count: number; subscription_status: string | null;
};

export type AdminOrgDetail = AdminOrgRow & {
  autonomy_level: number; onboarding_step: number; onboarding_completed: string | null;
  created_at: string; updated_at: string;
  members: {
    id: string; user_id: string; role: string; joined_at: string;
    email: string; name: string | null; user_status: string;
  }[];
  subscription: {
    id: string; status: string; plan_id: string; plan_name: string; plan_tier: string;
    current_period_start: string | null; current_period_end: string | null; cancel_at: string | null;
  } | null;
  usage: { month_year: string; credits_used: number; credits_limit: number; credits_purchased: number; created_at: string }[];
};

export type AdminObjectiveRow = {
  id: string; title: string; state: string; environment: string;
  user_email: string; org_name: string; created_at: string;
  target_profit: string; capital_approved: string;
};

export type AdminObjectiveDetail = {
  id: string; title: string; state: string; row_version: number; current_cycle: number;
  autonomy_level: number; target_profit: string; capital_approved: string;
  horizon_months: number; market: string; risk_tolerance: string; business_mode: string;
  environment: string; goal_type: string | null; created_at: string; deadline: string | null;
  user_email: string; user_id: string; venture_name: string | null; venture_industry: string | null;
  counts: { opportunities: number; experiments: number; missions: number; decisions: number;
    results: number; approvals_pending: number; executions_failed: number };
  missions: { id: string; status: string; priority: number; current_version: number;
    created_at: string; title: string | null; budget: string | null; execution_count: number }[];
  approvals: { id: string; category: string; status: string; why_required: string;
    capital_at_risk: string; expires_at: string; created_at: string }[];
};

export type AdminApprovalRow = {
  id: string; objective_id: string; category: string; status: string; resume_state: string;
  capital_at_risk: string; why_required: string; expires_at: string | null;
  decided_at: string | null; created_at: string; objective_title: string; owner_email: string;
};

export type AdminMissionRow = {
  id: string; status: string; priority: number; current_version: number; created_at: string;
  objective_id: string; objective_title: string; mission_title: string | null;
  budget: string | null; execution_count: number;
};

export type AdminProviderRow = {
  id: string; name: string; provider: string; base_url: string; model: string;
  role: string; is_primary: boolean; status: string; api_key_set: boolean;
  last_health_check_at: string | null; last_health_ok: boolean | null;
  last_health_message: string | null; created_at: string;
};

export type AdminAuditRow = {
  id: string; user_id: string | null; actor_email: string | null; action: string;
  target: string; detail: unknown; ip: string | null; created_at: string;
};

export type AdminSystemRow = {
  queue: { queued: number; active: number; failed: number; completed: number };
  events_count: number;
  model_runs: { count: number; failed: number; cost: string | null };
  providers: AdminProviderRow[];
  mode: string; node_env: string;
};

export type AdminEconomicsRow = {
  id: string; objective_id: string; objective_title: string;
  debit_account: string; credit_account: string; amount: string;
  verification_tier: string; memo: string | null; created_at: string;
};

// ── Fetch wrapper (admin) ──
async function adminFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => res.statusText);
    throw new Error(parseApiError(t || `HTTP ${res.status}`));
  }
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
}

// ── Overview ──
export function adminOverview(): Promise<AdminOverview> {
  return adminFetch<AdminOverview>("GET", "/overview");
}

// ── Users ──
export function adminUsers(params: { search?: string; status?: string; limit?: number; offset?: number } = {}): Promise<{ users: AdminUserRow[] }> {
  const q = new URLSearchParams();
  if (params.search) q.set("search", params.search);
  if (params.status) q.set("status", params.status);
  if (params.limit) q.set("limit", String(params.limit));
  if (params.offset) q.set("offset", String(params.offset));
  const qs = q.toString();
  return adminFetch<{ users: AdminUserRow[] }>("GET", `/users${qs ? `?${qs}` : ""}`);
}

export function adminUserDetail(id: string): Promise<{ user: AdminUserDetail }> {
  return adminFetch<{ user: AdminUserDetail }>("GET", `/users/${id}`);
}

export function adminUserUpdate(id: string, body: { role?: string; status?: string; is_admin?: boolean; name?: string }): Promise<{ user: Pick<AdminUserRow, "id" | "email" | "role" | "name" | "status" | "is_admin"> }> {
  return adminFetch("PATCH", `/users/${id}`, body);
}

export function adminUserSuspend(id: string): Promise<{ user: { id: string; status: string } }> {
  return adminFetch("POST", `/users/${id}/suspend`, {});
}

export function adminUserActivate(id: string): Promise<{ user: { id: string; status: string } }> {
  return adminFetch("POST", `/users/${id}/activate`, {});
}

export function adminUserGrantAdmin(id: string): Promise<{ user: { id: string; is_admin: boolean } }> {
  return adminFetch("POST", `/users/${id}/grant-admin`, {});
}

export function adminUserRevokeAdmin(id: string): Promise<{ user: { id: string; is_admin: boolean } }> {
  return adminFetch("POST", `/users/${id}/revoke-admin`, {});
}

export function adminUserDelete(id: string): Promise<{ deleted: boolean }> {
  return adminFetch("DELETE", `/users/${id}`);
}

// ── Orgs ──
export function adminOrgs(params: { search?: string; plan?: string; limit?: number; offset?: number } = {}): Promise<{ orgs: AdminOrgRow[] }> {
  const q = new URLSearchParams();
  if (params.search) q.set("search", params.search);
  if (params.plan) q.set("plan", params.plan);
  if (params.limit) q.set("limit", String(params.limit));
  if (params.offset) q.set("offset", String(params.offset));
  const qs = q.toString();
  return adminFetch<{ orgs: AdminOrgRow[] }>("GET", `/orgs${qs ? `?${qs}` : ""}`);
}

export function adminOrgDetail(id: string): Promise<{ organization: AdminOrgDetail; members: AdminOrgDetail["members"]; subscription: AdminOrgDetail["subscription"]; usage: AdminOrgDetail["usage"] }> {
  return adminFetch("GET", `/orgs/${id}`);
}

export function adminOrgUpdate(id: string, body: { name?: string; plan_tier?: string; status?: string; autonomy_level?: number }): Promise<{ organization: AdminOrgRow }> {
  return adminFetch("PATCH", `/orgs/${id}`, body);
}

export function adminOrgUpdateMember(orgId: string, userId: string, role: string): Promise<{ membership: { id: string; role: string } }> {
  return adminFetch("PATCH", `/orgs/${orgId}/members/${userId}`, { role });
}

export function adminOrgAddMember(orgId: string, body: { user_id: string; role: string }): Promise<{ membership: { id: string; role: string } }> {
  return adminFetch("POST", `/orgs/${orgId}/members`, body);
}

export function adminOrgRemoveMember(orgId: string, userId: string): Promise<{ removed: boolean }> {
  return adminFetch("DELETE", `/orgs/${orgId}/members/${userId}`);
}

// ── Objectives ──
export function adminObjectives(params: { state?: string; search?: string; limit?: number; offset?: number } = {}): Promise<{ objectives: AdminObjectiveRow[] }> {
  const q = new URLSearchParams();
  if (params.state) q.set("state", params.state);
  if (params.search) q.set("search", params.search);
  if (params.limit) q.set("limit", String(params.limit));
  if (params.offset) q.set("offset", String(params.offset));
  const qs = q.toString();
  return adminFetch<{ objectives: AdminObjectiveRow[] }>("GET", `/objectives${qs ? `?${qs}` : ""}`);
}

export function adminObjectiveDetail(id: string): Promise<{ objective: AdminObjectiveDetail }> {
  return adminFetch("GET", `/objectives/${id}`);
}

export function adminObjectiveUpdate(id: string, body: { title?: string; environment?: string }): Promise<{ objective: { id: string; state: string } }> {
  return adminFetch("PATCH", `/objectives/${id}`, body);
}

export function adminObjectiveStop(id: string, reason: string): Promise<{ state: string }> {
  return adminFetch("POST", `/objectives/${id}/stop`, { reason });
}

export function adminObjectiveResume(id: string, reason?: string): Promise<{ state: string }> {
  return adminFetch("POST", `/objectives/${id}/resume`, { reason });
}

// ── Approvals (admin approve/reject) ──
export function adminApprovals(params: { status?: string; limit?: number; offset?: number } = {}): Promise<{ approvals: AdminApprovalRow[] }> {
  const q = new URLSearchParams();
  if (params.status) q.set("status", params.status);
  if (params.limit) q.set("limit", String(params.limit));
  if (params.offset) q.set("offset", String(params.offset));
  const qs = q.toString();
  return adminFetch<{ approvals: AdminApprovalRow[] }>("GET", `/approvals${qs ? `?${qs}` : ""}`);
}

export function adminApprovalApprove(id: string, note?: string): Promise<{ status: string; resumed_to?: string }> {
  return adminFetch("POST", `/approvals/${id}/approve`, note ? { note } : {});
}

export function adminApprovalReject(id: string, reason: string): Promise<{ status: string; state?: string }> {
  return adminFetch("POST", `/approvals/${id}/reject`, { reason });
}

// ── Missions / Executions ──
export function adminMissions(params: { status?: string; limit?: number; offset?: number } = {}): Promise<{ missions: AdminMissionRow[] }> {
  const q = new URLSearchParams();
  if (params.status) q.set("status", params.status);
  if (params.limit) q.set("limit", String(params.limit));
  if (params.offset) q.set("offset", String(params.offset));
  const qs = q.toString();
  return adminFetch<{ missions: AdminMissionRow[] }>("GET", `/missions${qs ? `?${qs}` : ""}`);
}

export function adminExecutionDetail(id: string): Promise<{ execution: unknown }> {
  return adminFetch("GET", `/executions/${id}`);
}

export type AdminExecutionRow = {
  id: string; mission_id: string; mission_version: number; attempt: number; status: string;
  provider: string; provider_job_ref: string | null; started_at: string | null;
  finished_at: string | null; objective_id: string; objective_title: string;
  mission_title: string | null; verification_tier: string | null; revenue_claimed: string | null;
};

export function adminExecutions(params: { mission_id?: string; status?: string; limit?: number; offset?: number } = {}): Promise<{ executions: AdminExecutionRow[] }> {
  const q = new URLSearchParams();
  if (params.mission_id) q.set("mission_id", params.mission_id);
  if (params.status) q.set("status", params.status);
  if (params.limit) q.set("limit", String(params.limit));
  if (params.offset) q.set("offset", String(params.offset));
  const qs = q.toString();
  return adminFetch<{ executions: AdminExecutionRow[] }>("GET", `/executions${qs ? `?${qs}` : ""}`);
}

export function adminExecutionRetry(id: string, reason?: string): Promise<{ queued: boolean; new_attempt: number }> {
  return adminFetch("POST", `/executions/${id}/retry`, reason ? { reason } : {});
}

export function adminExecutionCancel(id: string, reason?: string): Promise<{ cancelled: boolean }> {
  return adminFetch("POST", `/executions/${id}/cancel`, reason ? { reason } : {});
}

// ── Billing ──
export function adminBilling(params: { org_id?: string; limit?: number; offset?: number } = {}): Promise<{
  subscriptions: unknown[]; usage: unknown[]; invoices: unknown[];
}> {
  const q = new URLSearchParams();
  if (params.org_id) q.set("org_id", params.org_id);
  if (params.limit) q.set("limit", String(params.limit));
  if (params.offset) q.set("offset", String(params.offset));
  const qs = q.toString();
  return adminFetch("GET", `/billing${qs ? `?${qs}` : ""}`);
}

// ── AI Providers ──
export function adminProviders(): Promise<{ providers: AdminProviderRow[] }> {
  return adminFetch("GET", "/providers");
}

export function adminProviderCreate(body: { name: string; base_url: string; api_key: string; model: string; role: string; is_primary?: boolean }): Promise<{ provider: AdminProviderRow }> {
  return adminFetch("POST", "/providers", body);
}

export function adminProviderUpdate(id: string, body: { name?: string; base_url?: string; api_key?: string; model?: string; role?: string; is_primary?: boolean; status?: string }): Promise<{ provider: AdminProviderRow }> {
  return adminFetch("PATCH", `/providers/${id}`, body);
}

export function adminProviderDelete(id: string): Promise<{ deleted: boolean }> {
  return adminFetch("DELETE", `/providers/${id}`);
}

export function adminProviderTest(id: string): Promise<{ ok: boolean; message: string; latency_ms: number | null }> {
  return adminFetch("POST", `/providers/${id}/test-connection`, {});
}

// ── System / Audit / Economics ──
export function adminSystem(): Promise<AdminSystemRow> {
  return adminFetch("GET", "/system");
}

export function adminAudit(params: { action?: string; user_id?: string; limit?: number; offset?: number } = {}): Promise<{ audit: AdminAuditRow[] }> {
  const q = new URLSearchParams();
  if (params.action) q.set("action", params.action);
  if (params.user_id) q.set("user_id", params.user_id);
  if (params.limit) q.set("limit", String(params.limit));
  if (params.offset) q.set("offset", String(params.offset));
  const qs = q.toString();
  return adminFetch<{ audit: AdminAuditRow[] }>("GET", `/audit${qs ? `?${qs}` : ""}`);
}

export function adminEconomics(params: { objective_id?: string; limit?: number } = {}): Promise<{ ledgers: AdminEconomicsRow[]; summary: { verified_revenue: string; verified_cost: string; total_drawdown: string; transactions: number } }> {
  const q = new URLSearchParams();
  if (params.objective_id) q.set("objective_id", params.objective_id);
  if (params.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  return adminFetch("GET", `/economics${qs ? `?${qs}` : ""}`);
}
