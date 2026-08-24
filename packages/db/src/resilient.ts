/**
 * @aee/db — resilient connection handling (production-safe).
 *
 * PRINSIP: DATABASE_URL / DATABASE_APP_URL dari env adalah SATU-SATUNYA
 * source of truth host/port. Tanpa hardcode localhost/IP WSL.
 */
import { Pool, type PoolClient, type PoolConfig } from "pg";

export interface ResilientPoolConfig {
  readonly url: string;
  readonly label?: string;
  readonly max?: number;
  readonly idleTimeoutMillis?: number;
  readonly connectionTimeoutMillis?: number;
  readonly onEvent?: (msg: string) => void;
}

export interface DbHealthState {
  readonly label: string;
  readonly db: "healthy" | "unhealthy";
  readonly lastCheckedAt: string | null;
  readonly lastError: string | null;
  readonly consecutiveFailures: number;
  readonly recoveringSince: string | null;
}

/** Error koneksi transient (retry-able). */
export function isTransientDbError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /ECONNREFUSED|ECONNRESET|EPIPE|ETIMEDOUT|ENOTFOUND|Connection terminated|terminating connection|connection timeout|57P01|server closed the connection/i.test(msg);
}

const TRANSIENT_RETRIES = 3;
const RETRY_BASE_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Pool yang tetap hidup melewati DB down.
 * - query(): bounded retry utk transient error (3x, backoff 250ms->2s).
 * - health(): membedakan API hidup vs DB siap; auto-recover.
 * - pool error tidak pernah menjatuhkan proses.
 */
export class ResilientPool {
  private readonly pool: Pool;
  private readonly label: string;
  private readonly log: (m: string) => void;
  private lastError: string | null = null;
  private lastOkAt: string | null = null;
  private failures = 0;
  private recoveringSince: string | null = null;
  private probeTimer: NodeJS.Timeout | null = null;

  /** Mulai probe latar (utk /health readiness akurat walau tanpa traffic). */
  startProbing(intervalMs = 5_000): void {
    this.stopProbing();
    const tick = async () => {
      try {
        await this.pool.query("SELECT 1");
        this.markOk();
      } catch (e) {
        this.failures += 1;
        this.lastError = e instanceof Error ? e.message : String(e);
        if (!this.recoveringSince) this.recoveringSince = new Date().toISOString();
      }
    };
    void tick();
    this.probeTimer = setInterval(() => void tick(), intervalMs);
    this.probeTimer.unref?.();
  }

  stopProbing(): void {
    if (this.probeTimer) clearInterval(this.probeTimer);
    this.probeTimer = null;
  }

  constructor(cfg: ResilientPoolConfig) {
    this.label = cfg.label ?? "db";
    this.log = cfg.onEvent ?? (() => {});
    const pc: PoolConfig = {
      connectionString: cfg.url,
      max: cfg.max ?? 8,
      idleTimeoutMillis: cfg.idleTimeoutMillis ?? 30_000,
      connectionTimeoutMillis: cfg.connectionTimeoutMillis ?? 5_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    };
    this.pool = new Pool(pc);
    this.pool.on("error", (err) => {
      this.failures += 1;
      this.lastError = err.message;
      if (!this.recoveringSince) this.recoveringSince = new Date().toISOString();
      this.log("[" + this.label + "] pool error (self-recover): " + err.message.slice(0, 120));
    });
  }

  /** Pool pg mentah (untuk pg-boss / caller khusus). */
  get raw(): Pool {
    return this.pool;
  }

  health(): DbHealthState {
    const db = this.failures === 0 ? "healthy" : "unhealthy";
    return {
      label: this.label,
      db,
      lastCheckedAt: this.lastOkAt,
      lastError: this.lastError,
      consecutiveFailures: this.failures,
      recoveringSince: this.recoveringSince,
    };
  }

  /** Bounded retry utk query satu-kali (transient error only). */
  async query(text: string, values?: readonly unknown[]): Promise<{ rows: unknown[] }> {
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= TRANSIENT_RETRIES; attempt++) {
      try {
        const r = await this.pool.query(text, values as unknown[] | undefined);
        this.markOk();
        return { rows: r.rows };
      } catch (e) {
        lastErr = e;
        if (!isTransientDbError(e)) throw e;
        this.failures += 1;
        this.lastError = e instanceof Error ? e.message : String(e);
        if (!this.recoveringSince) this.recoveringSince = new Date().toISOString();
        if (attempt < TRANSIENT_RETRIES) await sleep(RETRY_BASE_MS * Math.pow(4, attempt - 1));
      }
    }
    throw lastErr;
  }

  /** connect() pg biasa — dipakai API handler (dgn withClient try/finally). */
  async connect(): Promise<PoolClient> {
    return this.pool.connect();
  }

  private markOk(): void {
    this.lastOkAt = new Date().toISOString();
    if (this.failures > 0) {
      this.log("[" + this.label + "] DB recovered — pool healthy kembali");
      this.failures = 0;
      this.lastError = null;
      this.recoveringSince = null;
    }
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}
