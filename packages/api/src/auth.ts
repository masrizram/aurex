/**
 * Auth module — session-based authentication with cookie + X-User-Id fallback.
 * Uses Node.js built-in crypto.scrypt for password hashing (no external deps).
 */
/// <reference types="@fastify/cookie" />
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { FastifyReply, FastifyRequest } from "fastify";

const scrypt = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key))),
  );

const SESSION_DAYS = 7;
const COOKIE_NAME = "aee_session";

// ── Password hashing ──────────────────────────────────────────────────────────
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const saltHex = parts[1];
  const hashHex = parts[2];
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, salt);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ── Session management ────────────────────────────────────────────────────────
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

// ── Auth lifecycle tokens (008) — hash SHA-256, single-use, expiring ──────────
export function hashAuthToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function createAuthToken(
  client: PoolClient, userId: string, kind: "EMAIL_VERIFY" | "PASSWORD_RESET", ttlMinutes: number,
): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  await client.query(
    `INSERT INTO auth_tokens (user_id, kind, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
    [userId, kind, tokenHash, new Date(Date.now() + ttlMinutes * 60_000)],
  );
  return token;
}

export async function createSession(client: PoolClient, userId: string): Promise<string> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await client.query(
    `INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)`,
    [userId, token, expiresAt],
  );
  return token;
}

export interface SessionUser {
  userId: string;
  email: string;
  role: string;
  name: string | null;
  isAdmin: boolean;
  status: string;
}

export async function getSession(client: PoolClient, token: string): Promise<SessionUser | null> {
  const { rows } = await client.query<{
    user_id: string; email: string; role: string; name: string | null; is_admin: boolean; status: string;
  }>(
    `SELECT s.user_id, u.email, u.role, u.name, u.is_admin, u.status
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now() AND u.status = 'ACTIVE'`,
    [token],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return { userId: r.user_id, email: r.email, role: r.role, name: r.name, isAdmin: r.is_admin, status: r.status };
}

export async function deleteSession(client: PoolClient, token: string): Promise<void> {
  await client.query(`DELETE FROM sessions WHERE token = $1`, [token]);
}

// ── Cookie helpers (Fastify) ──────────────────────────────────────────────────
export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // Fastify maxAge dalam DETIK (bukan ms) — 7 hari.
    maxAge: SESSION_DAYS * 86_400,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(COOKIE_NAME, { path: "/" });
}

export function getSessionToken(request: FastifyRequest): string | null {
  const v = request.cookies?.[COOKIE_NAME];
  return typeof v === "string" && v.length > 0 ? v : null;
}

// ── Org + membership helpers ──────────────────────────────────────────────────
export async function createOrgForUser(
  client: PoolClient,
  userId: string,
  orgName: string,
): Promise<{ orgId: string }> {
  // F5 fix: slug collision TIDAK boleh menimpa org milik user lain.
  // Slug unik global (constraint DB) → buat slug unik dengan suffix userId bila bentrok.
  const base = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "org";
  const userTag = userId.slice(0, 8);
  const { rows: firstTry } = await client.query<{ id: string; slug: string }>(
    `INSERT INTO organizations (name, slug, plan_tier)
     VALUES ($1, $2, 'FREE')
     ON CONFLICT (slug) DO NOTHING
     RETURNING id, slug`,
    [orgName, base],
  );
  let orgId = firstTry[0]?.id ?? null;
  if (!orgId) {
    // Slug dipakai → cek apakah org itu milik user ini (membership OWNER ada);
    // kalau ya, pakai org itu; kalau bukan, buat slug baru bersuffix.
    const { rows: mine } = await client.query<{ id: string }>(
      `SELECT o.id FROM organizations o
       JOIN memberships m ON m.organization_id = o.id AND m.user_id = $1 AND m.role = 'OWNER'
       WHERE o.slug = $2 LIMIT 1`,
      [userId, base],
    );
    if (mine[0]) {
      orgId = mine[0].id;
    } else {
      const uniqueSlug = `${base}-${userTag}`;
      const { rows: retry } = await client.query<{ id: string }>(
        `INSERT INTO organizations (name, slug, plan_tier)
         VALUES ($1, $2, 'FREE')
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [orgName, uniqueSlug],
      );
      orgId = retry[0]?.id ?? null;
    }
  }
  if (!orgId) throw new Error("failed to create org");
  await client.query(
    `INSERT INTO memberships (organization_id, user_id, role)
     VALUES ($1, $2, 'OWNER')
     ON CONFLICT (organization_id, user_id) DO NOTHING`,
    [orgId, userId],
  );
  return { orgId };
}

export interface OrgInfo {
  id: string;
  name: string;
  slug: string;
  planTier: string;
  onboardingStep: number;
  onboardingCompleted: string | null;
  autonomyLevel: number;
}

export async function getOrgForUser(
  client: PoolClient,
  userId: string,
): Promise<OrgInfo | null> {
  const { rows } = await client.query<{
    id: string; name: string; slug: string; plan_tier: string;
    onboarding_step: number; onboarding_completed: string | null; autonomy_level: number;
  }>(
    `SELECT o.id, o.name, o.slug, o.plan_tier, o.onboarding_step, o.onboarding_completed::text, o.autonomy_level
     FROM memberships m JOIN organizations o ON o.id = m.organization_id
     WHERE m.user_id = $1 LIMIT 1`,
    [userId],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    id: r.id, name: r.name, slug: r.slug, planTier: r.plan_tier,
    onboardingStep: r.onboarding_step, onboardingCompleted: r.onboarding_completed,
    autonomyLevel: r.autonomy_level,
  };
}
