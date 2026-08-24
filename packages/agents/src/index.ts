/**
 * @aee/agents — Phase 4–5 (§9 Kimi, §10 GLM, §29 provider abstraction).
 *
 * - Kedua agen di balik interface (StrategicAgentProvider / ExecutionAgentProvider)
 *   → Kimi/GLM dapat diganti tanpa menyentuh business logic (§1 prinsip 5).
 * - Adapter OpenAI-compatible (Moonshot kimi-k3 / Zhipu glm-4.6) dengan transport
 *   yang disuntik → teruji unit tanpa jaringan.
 * - Retry transient 30s/2m/8m maks 3 (§3.1) → AgentExhaustedError(retryCount=3)
 *   → FSM T05/T17 guard retry_ge_3 → BLOCKED.
 * - Kimi: parse + Zod strict + repair-loop MAKS 1× (§3.1 validator).
 *   GLM: strict TANPA repair (§10 aturan 1) + cek referensi mission/execution
 *   (§10 aturan 2).
 * - Setiap panggilan menghasilkan ModelRunRecord → baris model_runs (reproducibility §12).
 */
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  type DecisionRecord, type ExperimentSpec, type GlmResult, type MissionPackage,
  type ResearchOutput, type SelectDecision, DecisionRecordSchema, ExperimentSpecSchema,
  GlmResultSchema, MissionPackageSchema, ResearchOutputSchema, SelectDecisionSchema,
} from "@aee/contracts";
import type { ExecutionStatus } from "@aee/domain";

export type { DecisionRecord, ExperimentSpec, GlmResult, MissionPackage, ResearchOutput, SelectDecision };

// ── §9 / §29: provider interfaces ────────────────────────────────────────────

export interface ObjectiveSummary {
  readonly id: string;
  readonly title: string;
  readonly market: string;
  readonly riskTolerance: "low" | "moderate" | "high";
  readonly targetProfit: string;
  // Phase 15 business identity (optional utk backward-compat test):
  readonly businessName?: string;
  readonly businessIndustry?: string;
  readonly businessCustomer?: string;
  readonly businessProblem?: string;
  readonly businessSolution?: string;
  readonly businessModel?: string;
  readonly businessMode?: "GIVEN" | "DISCOVERY";
  readonly capitalApproved: string;
  readonly horizonMonths: number;
  readonly environment: string;
}

export interface MemoryItem {
  readonly kind: "FACT" | "BELIEF" | "OBSERVATION" | "DECISION";
  readonly content: string;
}

export interface RankedOpportunity {
  readonly id: string;
  readonly name: string;
  readonly riskAdjustedScore: string;
  readonly capitalRequired: string;
  readonly expectedValue: string;
}

export interface ResearchInput {
  readonly objective: ObjectiveSummary;
  readonly relevantMemory?: readonly MemoryItem[];
}

export interface RankInput {
  readonly objective: ObjectiveSummary;
  readonly opportunities: readonly RankedOpportunity[];
}

export interface ExperimentInput {
  readonly objective: ObjectiveSummary;
  readonly opportunity: RankedOpportunity;
  readonly policies: { readonly maxSingleExperimentLoss: string };
}

export interface MissionInput {
  readonly objective: ObjectiveSummary;
  readonly opportunity: RankedOpportunity;
  readonly experiment?: { readonly id: string; readonly hypothesis: string };
  readonly decision: DecisionRecord;
}

export interface ResultInput {
  readonly objective: ObjectiveSummary;
  readonly mission: { readonly id: string; readonly version: number };
  readonly glmResult: GlmResult;
  readonly evidenceIds: readonly string[]; // uuid bukti nyata dari DB (§9 aturan keras)
}

export interface StrategicAgentProvider {
  research(input: ResearchInput): Promise<ResearchOutput>;
  rank_select(input: RankInput): Promise<SelectDecision>;
  designExperiment(input: ExperimentInput): Promise<ExperimentSpec>;
  designMission(input: MissionInput): Promise<MissionPackage>;
  interpretResults(input: ResultInput): Promise<DecisionRecord>;
}

export interface ExecutionHandle {
  readonly ref: string;                              // provider_job_ref (§7 executions)
  readonly result?: GlmResult;                       // provider sinkron langsung kembali
}

export interface ExecutionDispatchContext {
  readonly executionId: string;                      // EXECUTION_ID dari DB (§22)
  readonly cycleId: string;
}

export interface ExecutionAgentProvider {
  executeMission(pkg: MissionPackage, idem: string, ctx?: ExecutionDispatchContext): Promise<ExecutionHandle>;
  getStatus(ref: string): Promise<ExecutionStatus>;
  cancel(ref: string): Promise<void>;
}

// ── model_runs record (§7 model_runs, §12 reproducibility) ───────────────────

export interface ModelRunRecord {
  readonly agent: "KIMI" | "GLM";
  readonly purpose: string;
  readonly promptVersionId: string;
  readonly model: string;
  readonly modelVersion: string;
  readonly temperature: string;   // NUMERIC(3,2) kanonik, mis. "0.40"
  readonly tokenLimit: number;
  readonly inputContextHash: string; // sha256 JSON kanonik input
  readonly outputHash: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cost: string | null;   // NUMERIC(20,6)
  readonly latencyMs: number | null;
  readonly retries: number;
  readonly status: "SUCCEEDED" | "FAILED" | "REJECTED";
  readonly error: string | null;
}

/** JSON kanonik (kunci terurut rekursif) → hash reproducible. */
export function canonicalJson(value: unknown): string {
  const ser = (v: unknown): string => {
    if (v === null || typeof v !== "object") return JSON.stringify(v) as string;
    if (Array.isArray(v)) return `[${v.map(ser).join(",")}]`;
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${ser(o[k])}`).join(",")}}`;
  };
  return ser(value);
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

// ── Error taxonomy (§21 failure handling) ────────────────────────────────────

/** Kegagalan transient (timeout/jaringan/429/5xx) → retry dengan backoff. */
export class AgentTransientError extends Error {
  constructor(message: string, readonly detail?: unknown) { super(message); this.name = "AgentTransientError"; }
}

/** Kegagal permanen request (4xx auth/payload) → tidak di-retry. */
export class AgentFatalError extends Error {
  constructor(message: string, readonly status?: number) { super(message); this.name = "AgentFatalError"; }
}

/** Retry habis (≥3) → FSM T05/T17 → BLOCKED. */
export class AgentExhaustedError extends Error {
  constructor(readonly retryCount: number, cause: unknown) {
    super(`retry habis (${retryCount}×) setelah backoff 30s/2m/8m: ${String(cause)}`);
    this.name = "AgentExhaustedError";
  }
}

/** Output tidak schema-valid setelah repair-loop → RESULT_REJECTED. */
export class AgentSchemaError extends Error {
  constructor(message: string, readonly issues: string[]) { super(message); this.name = "AgentSchemaError"; }
}

/**
 * F14: AgentRunError membawa ModelRunRecord FAILED/REJECTED ke pemanggil,
 * agar caller bisa push run ke provider.runs SEBELUM re-throw.
 * Extends AgentSchemaError untuk backward-compat dengan test yang expect AgentSchemaError.
 */
export class AgentRunError extends AgentSchemaError {
  readonly run: ModelRunRecord;
  constructor(message: string, run: ModelRunRecord, issues?: string[]) { super(message, issues ?? [run.error ?? "unknown"]); this.name = "AgentRunError"; this.run = run; }
}

// ── Transport OpenAI-compatible (injectable) ─────────────────────────────────

export interface ChatMessage { readonly role: "system" | "user" | "assistant"; readonly content: string }

export interface ChatRequest {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly temperature: number;
  readonly max_tokens: number;
  readonly response_format?: { readonly type: "json_object" };
  readonly stream?: false;
}

export interface ChatUsage { readonly prompt_tokens?: number; readonly completion_tokens?: number }

export interface ChatResponse {
  readonly choices: readonly { readonly message: { readonly content: string } }[];
  readonly usage?: ChatUsage;
}

export type ChatTransport = (req: ChatRequest) => Promise<ChatResponse>;

const TRANSIENT_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/** Transport nyata via fetch (Node ≥18) ke endpoint OpenAI-compatible. */
export function fetchTransport(baseUrl: string, apiKey: string, timeoutMs = 180_000): ChatTransport {
  return async (req) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    // F9 fix: hard-timeout fallback — bila AbortController tidak efektif (undici
    // keep-alive), race dengan promise yang reject setelah timeoutMs + grace.
    // Timer diracet di finally agar tidak leak.
    const grace = 10_000;
    let hardTimer: ReturnType<typeof setTimeout> | undefined;
    const timeoutRace = new Promise<never>((_, reject) => {
      hardTimer = setTimeout(
        () => reject(new AgentTransientError(`hard timeout ${timeoutMs + grace}ms`)),
        timeoutMs + grace,
      );
    });
    try {
      const fetchPromise = fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ ...req, stream: false }),
        signal: ctrl.signal,
      }).then(async (res) => {
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          if (TRANSIENT_STATUS.has(res.status)) throw new AgentTransientError(`HTTP ${res.status}: ${body.slice(0, 300)}`);
          throw new AgentFatalError(`HTTP ${res.status}: ${body.slice(0, 300)}`, res.status);
        }
        return await res.json() as ChatResponse;
      });
      return await Promise.race([fetchPromise, timeoutRace]);
    } catch (e) {
      if (e instanceof AgentTransientError || e instanceof AgentFatalError) throw e;
      throw new AgentTransientError("jaringan/timeout gagal", e); // abort/fetch/DNS → transient
    } finally {
      clearTimeout(timer);
      if (hardTimer !== undefined) clearTimeout(hardTimer);
    }
  };
}

// ── Retry + validasi + repair-loop ────────────────────────────────────────────

export const BACKOFF_MS: readonly number[] = [30_000, 120_000, 480_000]; // §3.1
export const MAX_RETRIES = 3;                                            // T05/T17

export type Sleeper = (ms: number) => Promise<void>;
export const realSleep: Sleeper = (ms) => new Promise((r) => setTimeout(r, ms));

function isTransient(e: unknown): boolean {
  return e instanceof AgentTransientError;
}

class AgentParseError extends Error { constructor(readonly raw: string, cause: unknown) { super(`output bukan JSON: ${String(cause)}`); this.name = "AgentParseError"; } }

/** Stripping code-fence markdown bila model membungkus JSON. */
export function parseModelJson(text: string): unknown {
  const t = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(t);
  const body = fenced?.[1] ?? t;
  try {
    return JSON.parse(body);
  } catch (e) {
    throw new AgentParseError(text, e);
  }
}

function zodIssues(err: z.ZodError): string[] {
  return err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}

export interface RunOptions<T> {
  readonly agent: "KIMI" | "GLM";
  readonly purpose: string;
  readonly promptVersionId: string;
  readonly input: unknown;
  readonly schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  readonly transport: ChatTransport;
  readonly model: string;
  readonly modelVersion: string;
  readonly temperature: number;
  readonly tokenLimit: number;
  readonly sleeper: Sleeper;
  readonly clock: () => number;
  readonly allowRepair: boolean;     // Kimi: true (§3.1); GLM: true utk format (integritas via postValidate)
  readonly extraRules?: string;      // aturan tambahan spesifik-purpose (mis. evidence GLM)
  readonly postValidate?: (value: T) => void; // cek integritas tambahan (§10-2)
}

export interface RunResult<T> { readonly value: T; readonly run: ModelRunRecord }

async function callWithRetry(
  transport: ChatTransport, req: ChatRequest, sleeper: Sleeper,
): Promise<{ res: ChatResponse; retries: number }> {
  let retries = 0;
  for (;;) {
    try {
      return { res: await transport(req), retries };
    } catch (e) {
      if (!isTransient(e)) throw e;
      if (retries >= MAX_RETRIES) throw new AgentExhaustedError(retries, e);
      const delay = BACKOFF_MS[Math.min(retries, BACKOFF_MS.length - 1)] ?? 30_000;
      await sleeper(delay);
      retries += 1;
    }
  }
}

/**
 * Satu panggilan agen lengkap: retry transient → parse → Zod strict →
 * repair 1× (bila diizinkan) → postValidate. Semua kegagalan non-transient
 * setelah repair → AgentSchemaError (RESULT_REJECTED).
 */
export async function runValidated<T>(o: RunOptions<T>): Promise<RunResult<T>> {
  const started = o.clock();
  let retries = 0;
  const inputJson = canonicalJson(o.input);
  const schemaJson = JSON.stringify(zodToJsonSchema(o.schema, { target: "openApi3" }) as Record<string, unknown>);
  const agentName = o.agent === "KIMI" ? "KIMI K3, the strategic agent" : "GLM, the execution agent";
  const systemContent = `You are ${agentName}. Respond with a single JSON object ONLY. No prose, no markdown fences. The output must validate against this JSON Schema:

${schemaJson}

Rules:
- Financial values (revenue, cost, profit, budget, price, etc.) are strings with 2 decimal places, e.g. "1500000.00".
- UUIDs are standard UUID v4 strings.
- All required fields must be present.
- Do NOT wrap the JSON in markdown code fences.${o.extraRules ? `\n${o.extraRules}` : ""}`;
  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    { role: "user", content: `Context (JSON):
${inputJson}

Produce the JSON object that validates against the schema above.` },
  ];

  const attempt = async (baseMessages: readonly ChatMessage[]): Promise<{ value: T; res: ChatResponse; retries: number }> => {
    const { res, retries } = await callWithRetry(o.transport, {
      model: o.model, messages: baseMessages, temperature: o.temperature,
      max_tokens: o.tokenLimit, response_format: { type: "json_object" },
    }, o.sleeper);
    const text = res.choices[0]?.message.content ?? "";
    const parsed = parseModelJson(text);
    const check = o.schema.safeParse(parsed);
    if (!check.success) throw new AgentSchemaError(`output ${o.purpose} tidak schema-valid`, zodIssues(check.error));
    return { value: check.data, res, retries };
  };

  let lastError: unknown = null;
  let done: { value: T; res: ChatResponse; retries: number } | null = null;
  for (let callIdx = 0; callIdx <= (o.allowRepair ? 1 : 0); callIdx += 1) {
    try {
      const base = callIdx === 0
        ? messages
        : [...messages, { role: "assistant" as const, content: "…invalid output…" }, {
            role: "user" as const,
            content: `Your previous output failed schema validation: ${lastError instanceof AgentSchemaError ? lastError.issues.join("; ") : String(lastError)}. Return the corrected JSON object ONLY.`,
          }];
      done = await attempt(base);
      break;
    } catch (e) {
      lastError = e;
      if (e instanceof AgentSchemaError || e instanceof AgentParseError) continue; // → repair / reject
      throw e; // fatal / exhausted
    }
  }
  if (!done) {
    const issues = lastError instanceof AgentSchemaError ? lastError.issues : [String(lastError)];
    // F14: catat run REJECTED + lempar AgentRunError (bukan AgentSchemaError kosong).
    const rejectMsg = issues.join("; ");
    const failedRun: ModelRunRecord = {
      agent: o.agent, purpose: o.purpose, promptVersionId: o.promptVersionId,
      model: o.model, modelVersion: o.modelVersion,
      temperature: o.temperature.toFixed(2), tokenLimit: o.tokenLimit,
      inputContextHash: sha256Hex(inputJson), outputHash: null,
      inputTokens: null, outputTokens: null, cost: null,
      latencyMs: o.clock() - started, retries: 0,
      status: "REJECTED", error: rejectMsg,
    };
    throw new AgentRunError(`output ${o.purpose} REJECTED: ${rejectMsg}`, failedRun, issues);
  }

  // Cek integritas (§9/§10) — bukan masalah format; kegagalan propagasi apa adanya.
  // F14: bungkus postValidate error juga dengan AgentRunError.
  const outputJson = canonicalJson(done.value);
  const usage = done.res.usage;
  try {
    o.postValidate?.(done.value);
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    const failedRun: ModelRunRecord = {
      agent: o.agent, purpose: o.purpose, promptVersionId: o.promptVersionId,
      model: o.model, modelVersion: o.modelVersion,
      temperature: o.temperature.toFixed(2), tokenLimit: o.tokenLimit,
      inputContextHash: sha256Hex(inputJson), outputHash: sha256Hex(outputJson),
      inputTokens: usage?.prompt_tokens ?? estimateTokens(inputJson),
      outputTokens: usage?.completion_tokens ?? estimateTokens(outputJson),
      cost: null, latencyMs: o.clock() - started, retries: done.retries,
      status: "FAILED", error: errMsg,
    };
    // F14: pertahankan original error message agar test pattern matching tetap bekerja.
    throw new AgentRunError(`${errMsg}`, failedRun);
  }

  const res = done.res;
  return {
    value: done.value,
    run: {
      agent: o.agent, purpose: o.purpose, promptVersionId: o.promptVersionId,
      model: o.model, modelVersion: o.modelVersion,
      temperature: o.temperature.toFixed(2), tokenLimit: o.tokenLimit,
      inputContextHash: sha256Hex(inputJson), outputHash: sha256Hex(outputJson),
      inputTokens: usage?.prompt_tokens ?? estimateTokens(inputJson),
      outputTokens: usage?.completion_tokens ?? estimateTokens(outputJson),
      cost: null, // diisi billing adapter nyata (harga per token)
      latencyMs: o.clock() - started, retries: done.retries,
      status: "SUCCEEDED", error: null,
    },
  };
}

// ── Kimi adapter (Moonshot, OpenAI-compatible) ───────────────────────────────

export interface KimiAdapterConfig {
  readonly transport?: ChatTransport;
  readonly model?: string;         // default "kimi-k3" (§9)
  readonly tokenLimit?: number;
  readonly sleeper?: Sleeper;
  readonly clock?: () => number;
  readonly promptVersion?: string; // default "1"
}

const KIMI_TEMPERATURE: Record<string, number> = {
  research: 1,          // streamlake/kimi-k3 only accepts temperature=1
  rank_select: 1,
  design_experiment: 1,
  design_mission: 1,
  interpret_results: 1,
};

export class KimiAdapter implements StrategicAgentProvider {
  private readonly transport: ChatTransport;
  private readonly model: string;
  private readonly tokenLimit: number;
  private readonly sleeper: Sleeper;
  private readonly clock: () => number;
  private readonly promptVersion: string;
  /** Baris model_runs yang dihasilkan — dikonsumsi worker lalu di-INSERT. */
  readonly runs: ModelRunRecord[] = [];

  constructor(cfg: KimiAdapterConfig = {}) {
    this.transport = cfg.transport ?? fetchTransport(
      process.env.KIMI_BASE_URL ?? "https://api.moonshot.ai/v1",
      process.env.KIMI_API_KEY ?? "",
    );
    this.model = cfg.model ?? process.env.KIMI_MODEL ?? "kimi-k3";
    this.tokenLimit = cfg.tokenLimit ?? 8192;
    this.sleeper = cfg.sleeper ?? realSleep;
    this.clock = cfg.clock ?? Date.now;
    this.promptVersion = cfg.promptVersion ?? process.env.KIMI_PROMPT_VERSION ?? "1";
  }

  private async call<T>(purpose: string, schema: z.ZodType<T>, input: unknown, postValidate?: (v: T) => void): Promise<T> {
    try {
      const { value, run } = await runValidated<T>({
        agent: "KIMI", purpose, promptVersionId: `kimi.${purpose}@${this.promptVersion}`,
        input, schema, transport: this.transport, model: this.model, modelVersion: this.model,
        temperature: KIMI_TEMPERATURE[purpose] ?? 1, tokenLimit: this.tokenLimit,
        sleeper: this.sleeper, clock: this.clock, allowRepair: true, postValidate,
      });
      this.runs.push(run);
      return value;
    } catch (e) {
      // F14: catat run FAILED/REJECTED sebelum re-throw.
      if (e instanceof AgentRunError) { this.runs.push(e.run); }
      throw e;
    }
  }

  async research(input: ResearchInput): Promise<ResearchOutput> {
    return this.call("research", ResearchOutputSchema, input);
  }
  async rank_select(input: RankInput): Promise<SelectDecision> {
    return this.call("rank_select", SelectDecisionSchema, input, (v) => {
      if (!input.opportunities.some((o) => o.id === v.selected_opportunity_id)) {
        throw new AgentSchemaError("pilihan ∉ ranked list (guard T08)", [`selected=${v.selected_opportunity_id}`]);
      }
    });
  }
  async designExperiment(input: ExperimentInput): Promise<ExperimentSpec> {
    return this.call("design_experiment", ExperimentSpecSchema, input, (v) => {
      if (parseFloat(v.budget) > parseFloat(input.policies.maxSingleExperimentLoss)) {
        throw new AgentSchemaError("budget > MAX_SINGLE_EXPERIMENT_LOSS (guard T09)", [`budget=${v.budget}`]);
      }
    });
  }
  async designMission(input: MissionInput): Promise<MissionPackage> {
    return this.call("design_mission", MissionPackageSchema, input);
  }
  async interpretResults(input: ResultInput): Promise<DecisionRecord> {
    return this.call("interpret_results", DecisionRecordSchema, input, (v) => {
      if (!input.evidenceIds.some((id) => v.evidence_ids.includes(id))) {
        throw new AgentSchemaError("evidence_ids harus merujuk bukti nyata DB (§9 aturan keras)", ["evidence_ids tidak beririsan dengan DB"]);
      }
    });
  }
}

// ── GLM adapter (Zhipu, OpenAI-compatible) ───────────────────────────────────

export interface GlmAdapterConfig {
  readonly transport?: ChatTransport;
  readonly model?: string;         // default "glm-4.6" (§10)
  readonly tokenLimit?: number;
  readonly sleeper?: Sleeper;
  readonly clock?: () => number;
  readonly promptVersion?: string;
}

export class GlmAdapter implements ExecutionAgentProvider {
  private readonly transport: ChatTransport;
  private readonly model: string;
  private readonly tokenLimit: number;
  private readonly sleeper: Sleeper;
  private readonly clock: () => number;
  private readonly promptVersion: string;
  private readonly handles = new Map<string, ExecutionHandle>();
  readonly runs: ModelRunRecord[] = [];

  constructor(cfg: GlmAdapterConfig = {}) {
    this.transport = cfg.transport ?? fetchTransport(
      process.env.GLM_BASE_URL ?? "https://open.bigmodel.cn/api/paas/v4",
      process.env.GLM_API_KEY ?? "",
    );
    this.model = cfg.model ?? process.env.GLM_MODEL ?? "glm-4.6";
    this.tokenLimit = cfg.tokenLimit ?? 8192;
    this.sleeper = cfg.sleeper ?? realSleep;
    this.clock = cfg.clock ?? Date.now;
    this.promptVersion = cfg.promptVersion ?? process.env.GLM_PROMPT_VERSION ?? "1";
  }

  /** §10-1/2: strict TANPA repair + referensi wajib cocok (anti-halusinasi). */
  async executeMission(pkg: MissionPackage, idem: string, ctx?: ExecutionDispatchContext): Promise<ExecutionHandle> {
    try {
      const { value, run } = await runValidated<GlmResult>({
        agent: "GLM", purpose: "execute", promptVersionId: `glm.execute@${this.promptVersion}`,
        input: { mission: pkg, idempotency_key: idem, execution: ctx ?? null },
        schema: GlmResultSchema, transport: this.transport, model: this.model, modelVersion: this.model,
        temperature: 1, tokenLimit: this.tokenLimit,                  // streamlake/glm-5.2 only accepts temperature=1
        sleeper: this.sleeper, clock: this.clock, allowRepair: true,  // §10-1: repair sekali utk format (integritas tetap strict via postValidate)
        extraRules: `- The "execution" field in the context contains the execution_id you MUST echo verbatim in your output "execution_id" field.\n- "evidence" must be an array. Each item needs "kind" ("url"|"file"|"metric"), "uri" (non-empty string), and "sha256" (EXACTLY 64 lowercase hexadecimal characters — compute a real sha256 of the evidence content, or omit the item entirely).\n- If you cannot produce a genuine 64-hex sha256 for an evidence item, return an empty evidence array: "evidence": []. NEVER fabricate a placeholder hash.\n- mission_id and mission_version must echo the values from the mission package in the context, exactly.`,
        postValidate: (v) => {
          if (v.mission_id !== pkg.mission_id || v.mission_version !== pkg.mission_version) {
            throw new AgentSchemaError("referensi misi tidak cocok (§10-2)", [
              `mission_id=${v.mission_id} vs ${pkg.mission_id}`,
              `mission_version=${v.mission_version} vs ${pkg.mission_version}`,
            ]);
          }
          if (ctx && v.execution_id !== ctx.executionId) {
            throw new AgentSchemaError("execution_id tidak cocok execution RUNNING (§10-2)", [
              `execution_id=${v.execution_id} vs ${ctx.executionId}`,
            ]);
          }
        },
      });
      this.runs.push(run);
      const handle: ExecutionHandle = { ref: `glm:${run.outputHash?.slice(0, 16) ?? randomUUID()}`, result: value };
      this.handles.set(handle.ref, handle);
      return handle;
    } catch (e) {
      // F14: catat run FAILED/REJECTED sebelum re-throw.
      if (e instanceof AgentRunError) { this.runs.push(e.run); }
      throw e;
    }
  }

  async getStatus(ref: string): Promise<ExecutionStatus> {
    const h = this.handles.get(ref);
    if (!h) throw new AgentFatalError(`ref tidak dikenal: ${ref}`, 404);
    return h.result ? "SUCCEEDED" : "RUNNING";
  }

  async cancel(ref: string): Promise<void> {
    const h = this.handles.get(ref);
    if (!h) throw new AgentFatalError(`ref tidak dikenal: ${ref}`, 404);
    this.handles.set(ref, { ref, result: undefined });
  }
}

// ── Mock providers (§36 demo SIMULATED — jangan fabrikasi sukses nyata) ──────

export interface MockStrategicOverrides {
  readonly research?: Partial<ResearchOutput>;
  readonly interpretDecision?: DecisionRecord["decision"];
}

export class MockStrategicAgent implements StrategicAgentProvider {
  readonly runs: ModelRunRecord[] = [];
  constructor(private readonly overrides: MockStrategicOverrides = {}) {}

  private record(purpose: string, input: unknown): string {
    const hash = sha256Hex(canonicalJson({ purpose, input }));
    this.runs.push({
      agent: "KIMI", purpose, promptVersionId: `kimi.${purpose}@mock`,
      model: "mock-kimi", modelVersion: "mock", temperature: "0.20", tokenLimit: 0,
      inputContextHash: hash, outputHash: null, inputTokens: 0, outputTokens: 0,
      cost: "0.000000", latencyMs: 0, retries: 0, status: "SUCCEEDED", error: null,
    });
    return hash;
  }

  async research(input: ResearchInput): Promise<ResearchOutput> {
    this.record("research", input);
    const m = input.objective.market;
    const biz = input.objective; // Phase 15: business identity (optional utk test lama)
    // Mode A (GIVEN): opportunity pertama = optimasi bisnis user sendiri.
    const givenOpp = biz.businessName ? {
      name: `${biz.businessName} — optimasi ${biz.businessModel ?? "model"}`.slice(0, 120),
      customer_segment: biz.businessCustomer ?? `Segmen target ${m}`,
      problem: biz.businessProblem ?? "Masalah inti pelanggan",
      solution: biz.businessSolution ?? "Solusi inti produk",
      business_model: biz.businessModel ?? "Langganan bulanan",
      price: "750000.00",
      revenue_potential: "15000000.00",
      cost_estimate: "5000000.00",
      capital_required: "900000.00",
      time_to_revenue_days: 30,
      assumptions: ["Bisnis existing dapat diskalakan dengan modal berjalan", "Pelanggan existing potensial untuk upsell"],
      unknowns: ["Elastisitas harga di segmen existing", "CAC segmen baru"],
    } : null;
    const base = {
      opportunities: [
        ...(givenOpp ? [givenOpp] : []),
        {
          name: `Layanan konsultasi keuangan digital UMKM ${m}`,
          customer_segment: `Pemilik UMKM ${m} dengan omzet bulanan Rp10-50 juta`,
          problem: "Pencatatan keuangan manual sehingga sulit menilai profitabilitas dan mengakses modal",
          solution: "Layanan pembukuan terstruktur + dashboard mingguan + ringkasan bank-ready untuk pengajuan kredit",
          business_model: "Langganan bulanan per bisnis",
          price: "350000.00",
          revenue_potential: "12000000.00",
          cost_estimate: "4000000.00",
          capital_required: "800000.00",
          time_to_revenue_days: 30,
          assumptions: ["UMKM bersedia membayar langganan pencatatan", "Akuisisi awal via komunitas"],
          unknowns: [" Tingkat retensi setelah 3 bulan", "Biaya akuisisi aktual"],
        },
        {
          name: `Marketplace jasa konten lokal ${m}`,
          customer_segment: `Brand kecil-menengah butuh konten lokal ${m}`,
          problem: "Produksi konten lokal tersebar, kualitas tidak konsisten, harga tidak transparan",
          solution: "Marketplace kurasi kreator dengan paket harga tetap dan SLA revisi",
          business_model: "Komisi 20% per transaksi",
          price: "750000.00",
          revenue_potential: "9000000.00",
          cost_estimate: "3500000.00",
          capital_required: "1200000.00",
          time_to_revenue_days: 45,
          assumptions: ["Pasokan kreator cukup di fase awal", "Brand mengulang pesanan"],
          unknowns: ["Elastisitas harga paket", "Churn kreator"],
        },
      ],
    };
    const o0 = base.opportunities[0]!;
    const o1 = base.opportunities[1]!;
    const merged: ResearchOutput = {
      opportunities: [
        { ...o0, ...(this.overrides.research?.opportunities?.[0] ?? {}) },
        { ...o1, ...(this.overrides.research?.opportunities?.[1] ?? {}) },
      ],
    };
    return ResearchOutputSchema.parse(merged);
  }

  async rank_select(input: RankInput): Promise<SelectDecision> {
    this.record("rank_select", input);
    const top = [...input.opportunities].sort((a, b) => parseFloat(b.riskAdjustedScore) - parseFloat(a.riskAdjustedScore))[0];
    if (!top) throw new AgentSchemaError("ranked list kosong", ["opportunities=[]"]);
    return SelectDecisionSchema.parse({
      selected_opportunity_id: top.id,
      reason: `Skor terisk-adjusted tertinggi (${top.riskAdjustedScore}) dengan modal terjangkau (${top.capitalRequired}) dan EV positif (${top.expectedValue}); selaras risk tolerance ${input.objective.riskTolerance} dan horizon ${input.objective.horizonMonths} bulan.`,
      confidence: 0.62,
      assumptions: ["Skor engine valid", "Estimasi modal akurat ±20%"],
    });
  }

  async designExperiment(input: ExperimentInput): Promise<ExperimentSpec> {
    this.record("design_experiment", input);
    return ExperimentSpecSchema.parse({
      opportunity_id: input.opportunity.id,
      hypothesis: `Segmen ${input.opportunity.name} akan berkonversi ≥5% dalam 14 hari pertama`,
      objective: `Memvalidasi permintaan ${input.opportunity.name} dengan belanja minimal`,
      budget: input.policies.maxSingleExperimentLoss,
      duration_days: 14,
      success_metric: "conversion_rate",
      success_threshold: "0.0500",
      failure_threshold: "0.0100",
      kill_criteria: ["Konversi < 1% setelah 10 hari", "CPA > 3× harga"],
      scale_criteria: ["Konversi ≥ 5%", "CPA < harga"],
      information_gain_target: "Elastisitas harga dan saluran akuisisi terbaik",
    });
  }

  async designMission(input: MissionInput): Promise<MissionPackage> {
    this.record("design_mission", input);
    const o = input.objective;
    const opp = input.opportunity;
    return MissionPackageSchema.parse({
      mission_id: randomUUID(),
      mission_version: 1,
      objective: o.title,
      strategic_goal: `Mencapai profit ${o.targetProfit} dalam ${o.horizonMonths} bulan via ${opp.name}`,
      business_context: `Pasar ${o.market}, risk tolerance ${o.riskTolerance}, modal disetujui ${o.capitalApproved}, lingkungan ${o.environment}.`,
      target_customer: `Segmen dari opportunity ${opp.id}`,
      customer_problem: "Sebagaimana teridentifikasi pada opportunity terpilih",
      value_proposition: `Proposisi nilai ${opp.name}`,
      product_or_service: opp.name,
      business_model: "Langganan/transaksi sesuai opportunity",
      pricing: "Sesuai harga pada opportunity",
      expected_economics: {
        revenue_target: "3000000.00",
        cost_estimate: "1500000.00",
        expected_profit: "1500000.00",
        assumptions: ["Asumsi proposal Kimi — bukan fakta ledger"],
      },
      strategic_rationale: input.decision.reason,
      priority: 3,
      tasks: [
        { task_id: "T-1", title: "Siapkan landing + funnel", description: "Halaman validasi dengan CTA", depends_on: [] },
        { task_id: "T-2", title: "Jalankan akuisisi terukur", depends_on: ["T-1"] },
      ],
      technical_requirements: ["Static site", "Analytics"],
      data_requirements: ["Event konversi"],
      api_requirements: [],
      architecture_requirements: ["Serverless bila mungkin"],
      ui_requirements: ["Mobile-first"],
      automation_requirements: [],
      security_requirements: ["Tidak menyimpan data pribadi sensitif"],
      deployment_requirements: ["Preview URL untuk inspeksi owner"],
      analytics_requirements: ["Funnel harian"],
      operational_requirements: ["Monitoring uptime"],
      budget: input.objective.capitalApproved,
      time_limit: { hard_deadline_hours: 72 },
      hard_constraints: ["Jangan melebihi budget", "Jangan mengubah pricing tanpa approval"],
      soft_constraints: ["Preferensi stack ringan"],
      acceptance_criteria: ["Semua task selesai", "Metrik terukur terisi"],
      test_requirements: ["Smoke test funnel"],
      success_metrics: ["revenue", "conversion_rate"],
      success_thresholds: { revenue: "1000000.0000", conversion_rate: "0.0500" },
      failure_thresholds: { revenue: "0.0000", conversion_rate: "0.0100" },
      kill_criteria: ["Budget habis tanpa konversi"],
      scale_criteria: ["Konversi ≥ threshold sukses"],
      deliverables: ["Landing live", "Laporan metrik"],
      reporting_requirements: ["Ringkasan harian"],
      escalation_conditions: ["Blocker > 24 jam", "Biaya menyimpang > 20%"],
    });
  }

  async interpretResults(input: ResultInput): Promise<DecisionRecord> {
    this.record("interpret_results", input);
    const map: Record<string, DecisionRecord["decision"]> = {
      CONTINUE: "ITERATE", STOP: "KILL", ESCALATE: "ESCALATE_TO_HUMAN",
    };
    const decision = this.overrides.interpretDecision ?? map[input.glmResult.recommendation] ?? "ITERATE";
    return DecisionRecordSchema.parse({
      decision,
      subject_id: input.mission.id,
      reason: `Hasil eksekusi tier ${input.glmResult.status}: ${input.glmResult.summary.slice(0, 120)} — metrik revenue ${input.glmResult.business_metrics.revenue} dievaluasi terhadap threshold misi sebelum keputusan lanjut.`,
      evidence_ids: input.evidenceIds.slice(0, 1),
      metrics: {
        revenue: parseFloat(input.glmResult.business_metrics.revenue),
        cost: parseFloat(input.glmResult.business_metrics.cost),
        conversion: input.glmResult.business_metrics.conversions,
      },
      assumptions: ["Interpretasi berbasis hasil SELF_REPORTED — belum rekonsiliasi"],
      confidence: 0.55,
      expected_value_next: "1500000.00",
    });
  }
}

export interface MockExecutionOptions {
  readonly status?: GlmResult["status"];
  readonly recommendation?: GlmResult["recommendation"];
  readonly revenue?: string; // "0.00" default → SELF_REPORTED, ledger tak tersentuh
}

export class MockExecutionAgent implements ExecutionAgentProvider {
  readonly runs: ModelRunRecord[] = [];
  private readonly handles = new Map<string, ExecutionHandle>();

  constructor(private readonly options: MockExecutionOptions = {}) {}

  async executeMission(pkg: MissionPackage, idem: string, ctx?: ExecutionDispatchContext): Promise<ExecutionHandle> {
    const inputHash = sha256Hex(canonicalJson({ pkg, idem }));
    this.runs.push({
      agent: "GLM", purpose: "execute", promptVersionId: "glm.execute@mock",
      model: "mock-glm", modelVersion: "mock", temperature: "0.10", tokenLimit: 0,
      inputContextHash: inputHash, outputHash: null, inputTokens: 0, outputTokens: 0,
      cost: "0.000000", latencyMs: 0, retries: 0, status: "SUCCEEDED", error: null,
    });
    const result: GlmResult = GlmResultSchema.parse({
      mission_id: pkg.mission_id,
      mission_version: pkg.mission_version,
      execution_id: ctx?.executionId ?? randomUUID(),
      status: this.options.status ?? "SUCCEEDED",
      objective_status: "ON_TRACK",
      summary: `Eksekusi mock (SIMULATED) misi v${pkg.mission_version}: ${pkg.tasks.length} task, ${pkg.deliverables.length} deliverable.`,
      work: { completed: pkg.tasks.map((t) => t.task_id), files_created: [], files_modified: [], files_deleted: [], systems_changed: [] },
      verification: { tests_run: 1, test_results: { passed: 1, failed: 0 }, build_result: "PASS", deployment_result: "PREVIEW", runtime_result: "HEALTHY" },
      business_metrics: {
        traffic: 0, leads: 0, customers: 0, conversions: 0,
        revenue: this.options.revenue ?? "0.00", cost: "0.00", profit: "0.00", cac: "0.00", retention: 0,
      },
      signals: { observed_market_signal: "SIMULATED — tidak ada sinyal nyata", customer_signal: "SIMULATED" },
      errors: [], blockers: [], assumptions: ["Seluruh hasil adalah mock"], unverified_items: ["semua metrik"],
      recommendation: this.options.recommendation ?? "CONTINUE",
      evidence: [], // revenue 0 + tanpa evidence → SELF_REPORTED (D8)
    });
    const handle = { ref: `mock:${idem}`, result };
    this.handles.set(handle.ref, handle);
    return handle;
  }

  async getStatus(ref: string): Promise<ExecutionStatus> {
    const h = this.handles.get(ref);
    if (!h) throw new AgentFatalError(`ref tidak dikenal: ${ref}`, 404);
    return h.result ? "SUCCEEDED" : "RUNNING";
  }

  async cancel(ref: string): Promise<void> {
    const h = this.handles.get(ref);
    if (!h) throw new AgentFatalError(`ref tidak dikenal: ${ref}`, 404);
    this.handles.set(ref, { ref });
  }
}

// ── Factory: env-driven agent selection (industrialisasi) ────────────────────

export interface AgentDeps {
  readonly strategic: StrategicAgentProvider;
  readonly execution: ExecutionAgentProvider;
  readonly mode: "REAL" | "MOCK";
  readonly modelLabel: string;
}

/**
 * Buat agent deps dari environment.
 * - Jika KIMI_API_KEY dan GLM_API_KEY keduanya non-empty → adapter NYATA (9router/OpenAI-compatible).
 * - Jika salah satu kosong → fallback ke Mock (demo mode).
 * - Opsi override tersedia untuk testing.
 */
export function createAgents(opts?: {
  strategic?: StrategicAgentProvider;
  execution?: ExecutionAgentProvider;
}): AgentDeps {
  const kimiKey = process.env.KIMI_API_KEY ?? "";
  const glmKey = process.env.GLM_API_KEY ?? "";

  if (kimiKey && glmKey && !process.env.AEE_FORCE_MOCK) {
    const strategic = opts?.strategic ?? new KimiAdapter();
    const execution = opts?.execution ?? new GlmAdapter();
    const kModel = process.env.KIMI_MODEL ?? "kimi-k3";
    const gModel = process.env.GLM_MODEL ?? "glm-4.6";
    return {
      strategic,
      execution,
      mode: "REAL",
      modelLabel: `KIMI=${kModel} · GLM=${gModel}`,
    };
  }

  return {
    strategic: opts?.strategic ?? new MockStrategicAgent(),
    execution: opts?.execution ?? new MockExecutionAgent({ revenue: "600000.00" }),
    mode: "MOCK",
    modelLabel: "mock-strategic · mock-glm",
  };
}
