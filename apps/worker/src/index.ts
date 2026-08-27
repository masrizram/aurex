/**
 * apps/worker — Worker process (Phase 12, §11 "Efek async dieksekusi sebagai job").
 *
 * Satu proses Node berjalan terus:
 *   1. pg-boss boss instance (owner) — membuat queue `advance` bila belum.
 *   2. Poll job → dispatch per kind (runAgentJob vs dispatchJob mission-manager).
 *   3. Backoff 30s/2m/8m dari pg-boss (retryLimit 3) → kegagalan job tercatat
 *      di psql.boss.job; setelah 3× → job dead-letter (state failed) — worker
 *      TIDAK advance FSM saat gagal (prinsip §11: crash mid-transition aman).
 *   4. Graceful shutdown SIGINT/SIGTERM: berhenti poll, tunggu job aktif selesai.
 *
 * Provider: mock (demo §36) atau Kimi/GLM via env (implementasi provider ada
 * di packages/agents — sesi Kimi).
 */
import { Pool } from "pg";
import { poolConfigFor } from "@aee/db";
import pgBossCtor from "pg-boss";
import {
  InMemoryQueue, PgBossQueue, QUEUE_ADVANCE, runAgentJob,
  type AgentJob, type AgentJobKind, type OrchestratorDeps,
} from "@aee/orchestrator/runtime";
import { dispatchJob, type MissionJob } from "@aee/orchestrator/mission-manager";
import "dotenv/config";
import { createAgents } from "@aee/agents";

export interface WorkerOptions {
  readonly appUrl: string;          // DATABASE_APP_URL (aee_app, bukan superuser)
  readonly adminUrl: string;        // superuser — untuk pg-boss schema sendiri
  readonly pollIntervalMs?: number; // default 500
  readonly boss?: PgBossLike;        // injeksi untuk test
  readonly deps?: OrchestratorDeps; // injeksi untuk test
  readonly logger?: (msg: string) => void;
  /** Mode drain: berhenti setelah antrean kosong 2 poll berurutan (tanpa loop abadi). */
  readonly drain?: boolean;
}

/** Minimal surface pg-boss yang dipakai worker (test boleh stub). */
export interface PgBossLike {
  start(): Promise<void>;
  createQueue(name: string): Promise<unknown>;
  send(name: string, data: object, options?: Record<string, unknown>): Promise<string | null>;
  fetch(name: string, options?: Record<string, unknown>): Promise<Array<{ id: string; data: object }>>;
  complete(name: string, id: string): Promise<void>;
  fail(name: string, id: string): Promise<void>;
  stop(opts?: { graceful?: boolean; timeout?: number }): Promise<void>;
}

const MISSION_KINDS: readonly AgentJobKind[] = ["interpret_results", "mission_next"];

export interface WorkerHandle {
  /** Berhenti poll & tutup boss. Idempoten. */
  readonly stop: () => Promise<void>;
  /** Jumlah job selesai (ok) / gagal — untuk test & /metrics worker. */
  readonly stats: () => { processed: number; failed: number };
  /** Menunggu hingga minimal n job terproses (test). */
  readonly waitProcessed: (n: number, timeoutMs?: number) => Promise<boolean>;
}

export async function startWorker(opts: WorkerOptions): Promise<WorkerHandle> {
  const log = opts.logger ?? (() => {});
  const pollMs = opts.pollIntervalMs ?? 500;
  const stats = { processed: 0, failed: 0 };

  const boss = opts.boss ?? (new pgBossCtor({ connectionString: opts.adminUrl }) as unknown as PgBossLike);
  // PgBoss instance adalah EventEmitter — error maintenance (mis. 57P01 saat VM
  // docker restart) TIDAK BOLEH crash proses; log dan lanjut.
  const bossEmitter = boss as unknown as { on?: (ev: string, fn: (e: unknown) => void) => void };
  bossEmitter.on?.("error", (e) => log(`boss error (diabaikan): ${String((e as Error)?.message ?? e).slice(0, 140)}`));
  await boss.start();
  log("boss started");
  await boss.createQueue(QUEUE_ADVANCE);
  log("queue created, starting fetch loop");

  // Worker deps: queue → boss (chaining advance berikutnya masuk antrean sama).
  // deps default = mock + queue menulis kembali ke boss (chaining antrean sama);
  // deps.injected (test/demo) dipakai apa adanya.
  const deps: OrchestratorDeps = opts.deps ?? {
    ...createAgents(),
    queue: new PgBossQueue(boss as unknown as ConstructorParameters<typeof PgBossQueue>[0]),
  };

  const appPool = new Pool(poolConfigFor(opts.appUrl, { max: 2 }));
  // Koneksi idle yang dibunuh admin/pg-boss maintenance tidak boleh crash proses.
  appPool.on("error", (err) => log(`pool error (diabaikan): ${String(err.message).slice(0, 120)}`));

  let running = true;
  let active = false;
  const waiters: Array<() => void> = [];

  // Konsumsi via boss.work() subscription — pg-boss v10 menyerahkan BATCH ARRAY
  // job (batchSize=1 → array 1 elemen). Bentuk: {id,name,data:{kind,objectiveId,idem}}.
  async function handleJob(input: unknown, markFail?: () => void): Promise<void> {
    if (!running) return; // shutdown: biarkan pg-boss requeue
    const job = (Array.isArray(input) ? input[0] : input) as
      { id?: string; data?: AgentJob } | AgentJob | undefined;
    const j: AgentJob | undefined = job && "data" in job && job.data
      ? job.data
      : (job as AgentJob | undefined);
    if (!j || typeof j.kind !== "string" || typeof j.objectiveId !== "string") {
      log(`SKIP job bentuk tak dikenal: ${JSON.stringify(input).slice(0, 120)}`);
      return;
    }
    active = true;
    const client = await appPool.connect();
    try {
      const out = MISSION_KINDS.includes(j.kind)
        ? await dispatchJob(client, j as MissionJob, deps)
        : await runAgentJob(client, j, deps);
      if (out.ok) {
        stats.processed += 1;
        log(`ok ${j.kind} ${j.objectiveId} :: ${out.detail ?? ""}`.slice(0, 160));
      } else {
        // Runner return ok:false (mis. GUARD_FAILED / STALE_STATE) — kegagalan
        // logis, BUKAN transient: complete-kan saja (state tujuan tidak tercapai,
        // retriable tidak akan mengubah hasil — guard/state tidak berubah).
        stats.failed += 1;
        log(`FAIL ${j.kind} ${j.objectiveId} :: ${JSON.stringify(out)}`.slice(0, 200));
      }
    } catch (e) {
      stats.failed += 1;
      const msg = String((e as Error)?.message ?? e).slice(0, 300);
      log(`CATCH ${j.kind} ${j.objectiveId} :: ${msg}`);
      // Tandai job gagal → pg-boss retry (retryLimit 3, backoff 30s/2m/8m).
      markFail?.();
      // Insert error event so dashboard shows it in lineage
      try {
        await client.query(
          `INSERT INTO events (objective_id, cycle_id, type, payload, correlation_id)
           VALUES ($1, NULL, 'AGENT_ERROR', $2::jsonb, gen_random_uuid())`,
          [j.objectiveId, JSON.stringify({ kind: j.kind, error: msg, ts: new Date().toISOString(), retriable: true })]);
      } catch { /* ignore event insert failure */ }
    } finally {
      client.release();
      active = false;
      for (const w of waiters.splice(0)) w();
    }
  }
  // Konsumsi via fetch() loop — lebih terkendali dari work(): interval eksplisit,
  // tak ada handler tersembunyi; pg-boss tetap mengurus retry/expire di DB.
  // §11: job GAGAL (exception) → boss.fail() → pg-boss retry (retryLimit 3,
  // backoff 30s/2m/8m) → dead-letter `failed`. FSM tidak di-advance saat gagal
  // (state objective tetap konsisten — runner idempoten per state saat re-drive).
  const FETCH_OPTIONS = { batchSize: 1 };
  let emptyPolls = 0;
  void (async () => {
    while (running) {
      try {
        const batch = await (boss as unknown as {
          fetch(name: string, opts?: Record<string, unknown>): Promise<Array<{ id: string; data: unknown }>>;
        }).fetch(QUEUE_ADVANCE, FETCH_OPTIONS);
        for (const item of batch ?? []) {
          let jobFailed = false;
          const markFail = () => { jobFailed = true; };
          await handleJob(item, markFail);
          if (jobFailed) {
            await (boss as unknown as {
              fail(name: string, id: string): Promise<void>;
            }).fail(QUEUE_ADVANCE, item.id);
          } else {
            await (boss as unknown as {
              complete(name: string, id: string): Promise<void>;
            }).complete(QUEUE_ADVANCE, item.id);
          }
        }
        if (!batch || batch.length === 0) {
          emptyPolls += 1;
          if (opts.drain && emptyPolls >= 2) { running = false; break; }
          await new Promise((r) => setTimeout(r, pollMs));
        } else {
          emptyPolls = 0;
        }
      } catch (e) {
        stats.failed += 1;
        log(`worker loop error: ${String((e as Error)?.message ?? e).slice(0, 140)}`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  })();

  async function stop(): Promise<void> {
    if (!running) return;
    running = false;
    // tunggu job aktif selesai (maks 30s)
    for (let i = 0; i < 300 && active; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    await appPool.end();
    await boss.stop({ graceful: true, timeout: 5000 });
  }

  async function waitProcessed(n: number, timeoutMs = 10_000): Promise<boolean> {
    const t0 = Date.now();
    while (stats.processed + stats.failed < n) {
      if (Date.now() - t0 > timeoutMs) return false;
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
        setTimeout(resolve, 50);
      });
    }
    return true;
  }

  return { stop, stats: () => ({ ...stats }), waitProcessed };
}
