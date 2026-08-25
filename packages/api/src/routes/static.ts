/**
 * @aee/api — penyajian aset statis: / (landing), /app|/admin|/auth|/onboarding
 * (dashboard SPA fallback), /landing, /dashboard.html.
 * (Diekstrak verbatim dari index.ts saat split §12/§13.)
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { RouteCtx } from "../context.js";

const ASSET_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets");

async function serveAsset(reply: FastifyReply, name: string): Promise<void> {
    const html = await readFile(join(ASSET_DIR, name), "utf8");
    reply.type("text/html; charset=utf-8").send(html);
}

/** Daftarkan rute aset statis. */
export function registerStaticRoutes(app: FastifyInstance, _ctx: RouteCtx): void {
  app.get("/", async (_req, reply) => {
    await serveAsset(reply, "landing.html");
  });

  const dashboardHtml = async (reply: FastifyReply) => serveAsset(reply, "dashboard.html");

  app.get("/app", async (_req, reply) => dashboardHtml(reply));
  app.get("/app/*", async (_req, reply) => dashboardHtml(reply));
  app.get("/admin", async (_req, reply) => dashboardHtml(reply));
  app.get("/admin/*", async (_req, reply) => dashboardHtml(reply));
  app.get("/auth", async (_req, reply) => dashboardHtml(reply));
  app.get("/auth/*", async (_req, reply) => dashboardHtml(reply));
  app.get("/onboarding", async (_req, reply) => dashboardHtml(reply));
  app.get("/onboarding/*", async (_req, reply) => dashboardHtml(reply));
  app.get("/dashboard.html", async (_req, reply) => dashboardHtml(reply));

  // ── Landing page (SEO-optimized, public, no session). ──────────────────────
  app.get("/landing", async (_req, reply) => {
    const here = dirname(fileURLToPath(import.meta.url));
    const html = await readFile(join(here, "..", "assets", "landing.html"), "utf8");
    reply.type("text/html; charset=utf-8").send(html);
  });
}
