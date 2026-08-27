import { describe, expect, it } from "vitest";
import { isNeonUrl, neonNormalize, poolConfigFor } from "../src/neon.js";

describe("neon connection helpers", () => {
  it("detects Neon hosts (neon.tech / neon.run)", () => {
    expect(isNeonUrl("postgresql://u:p@ep-abc.us-east-2.aws.neon.tech/neondb?sslmode=require")).toBe(true);
    expect(isNeonUrl("postgresql://u:p@db.xyz.stable.aws.neon.run/neondb")).toBe(true);
    expect(isNeonUrl("postgres://u:p@localhost:55432/aee")).toBe(false);
    expect(isNeonUrl("postgres://u:p@db.example.com/aee")).toBe(false);
  });

  it("injects sslmode=require for Neon URLs that lack it", () => {
    const out = neonNormalize("postgresql://u:p@ep-abc.aws.neon.tech/neondb");
    expect(out).toContain("sslmode=require");
    // Idempotent — doesn't double-append.
    expect(neonNormalize(out)).toBe(out);
  });

  it("prepends scheme when Neon URL is missing the postgres:// prefix", () => {
    const out = neonNormalize("user:pw@ep-abc.aws.neon.tech/neondb");
    expect(out.startsWith("postgresql://")).toBe(true);
    expect(out).toContain("sslmode=require");
  });

  it("leaves non-Neon URLs untouched", () => {
    const local = "postgres://postgres:pw@localhost:55432/aee";
    expect(neonNormalize(local)).toBe(local);
  });

  it("sets ssl: { rejectUnauthorized: true } in PoolConfig for Neon", () => {
    const cfg = poolConfigFor("postgresql://u:p@ep-abc.aws.neon.tech/neondb", { max: 4 });
    expect(cfg.connectionString).toContain("sslmode=require");
    expect(cfg.ssl).toEqual({ rejectUnauthorized: true });
    expect(cfg.max).toBe(4);
  });

  it("honours rejectUnauthorized override for self-signed endpoints", () => {
    const cfg = poolConfigFor("postgresql://u:p@ep-abc.aws.neon.tech/neondb", { rejectUnauthorized: false });
    expect(cfg.ssl).toEqual({ rejectUnauthorized: false });
  });

  it("does not force SSL for a plain local Postgres URL", () => {
    const cfg = poolConfigFor("postgres://postgres:pw@localhost:55432/aee", { max: 8 });
    expect(cfg.ssl).toBeUndefined();
  });
});
