/**
 * @aee/agents — agent-mode badge truthfulness tests.
 * Memastikan `/agent-mode` TIDAK mau berbohong: mode "REAL" hanya bila
 * createAgents() benar-benar akan instantiate adapter nyata (key + !forceMock
 * + baseUrl non-localhost). Dan forceMock=true ⇒ mustahil REAL meski key ada.
 * Semua murni dari env → deterministik, tanpa jaringan.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { providerModeFromEnv, recordProviderHealth, _resetProviderHealth } from "@aee/agents";

describe("providerModeFromEnv — truthfulness", () => {
  beforeEach(() => _resetProviderHealth());
  it("MOCK bila kedua key kosong (tanpa forceMock, tanpa url)", () => {
    const r = providerModeFromEnv({});
    expect(r.mode).toBe("MOCK");
    expect(r.kimi.mode).toBe("MOCK");
    expect(r.glm.mode).toBe("MOCK");
    expect(r.forceMock).toBe(false);
    expect(r.providers).toHaveLength(2);
  });

  it("MOCK bila forceMock=true meski key + url lengkap (kasus bug prod dulu)", () => {
    const env = {
      KIMI_API_KEY: "k", GLM_API_KEY: "g",
      KIMI_BASE_URL: "https://api.moonshot.ai/v1", GLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
      KIMI_MODEL: "kimi-k3", GLM_MODEL: "glm-5.2",
      AEE_FORCE_MOCK: "true",
    };
    const r = providerModeFromEnv(env);
    expect(r.forceMock).toBe(true);
    expect(r.mode).toBe("MOCK");            // JANGAN REAL — inilah inti defect yang dipatch
    expect(r.providers.every((p) => p.configured)).toBe(true); // config ada tapi dipaksa mock
    expect(r.kimi.mode).toBe("MOCK");
    expect(r.glm.mode).toBe("MOCK");
  });

  it("REAL bila key + url non-localhost + forceMock=false terpenuhi", () => {
    const env = {
      KIMI_API_KEY: "k", GLM_API_KEY: "g",
      KIMI_BASE_URL: "https://api.moonshot.ai/v1", GLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
      AEE_FORCE_MOCK: "false",
    };
    const r = providerModeFromEnv(env);
    expect(r.mode).toBe("REAL");
    expect(r.kimi.mode).toBe("REAL");
    expect(r.glm.mode).toBe("REAL");
  });

  it("NOT REAL bila baseUrl menunjuk localhost (NINEROUTER=localhost bug)", () => {
    const env = {
      KIMI_API_KEY: "k", GLM_API_KEY: "g",
      KIMI_BASE_URL: "http://localhost:20128/v1", GLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
      AEE_FORCE_MOCK: "false",
    };
    const r = providerModeFromEnv(env);
    // glm tetap real; kimi localhost → tidak configured → MOCK. Overall MIXED, bukan REAL.
    expect(r.providers.find((p) => p.name === "kimi")!.configured).toBe(false);
    expect(r.kimi.mode).toBe("MOCK");
    expect(r.mode).toBe("MIXED");           // BUKAN REAL — localhost dilarang
  });

  it("DEGRADED bila provider sempat tercatat unreachable (health-cache)", () => {
    recordProviderHealth("kimi", false, "ECONNREFUSED 127.0.0.1:20128");
    const env = {
      KIMI_API_KEY: "k", GLM_API_KEY: "g",
      KIMI_BASE_URL: "https://api.moonshot.ai/v1", GLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
      AEE_FORCE_MOCK: "false",
    };
    const r = providerModeFromEnv(env);
    expect(r.kimi.mode).toBe("DEGRADED");
    expect(r.mode).toBe("DEGRADED");
    expect(r.providers.find((p) => p.name === "kimi")!.reachable).toBe(false);
    expect(r.providers.find((p) => p.name === "kimi")!.lastError).toContain("ECONNREFUSED");
  });

  it("REAL pulih setelah health-cache sukses kembali", () => {
    recordProviderHealth("kimi", true);
    const env = {
      KIMI_API_KEY: "k", GLM_API_KEY: "g",
      KIMI_BASE_URL: "https://api.moonshot.ai/v1", GLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
      AEE_FORCE_MOCK: "false",
    };
    const r = providerModeFromEnv(env);
    expect(r.kimi.mode).toBe("REAL");
    expect(r.mode).toBe("REAL");
    expect(r.providers.find((p) => p.name === "kimi")!.reachable).toBe(true);
  });

  it("back-compat: kimi/glm tetap punya {mode, model}", () => {
    const env = { KIMI_MODEL: "custom-kimi", GLM_MODEL: "custom-glm" };
    const r = providerModeFromEnv(env);
    expect(r.kimi).toEqual({ mode: "MOCK", model: "custom-kimi" });
    expect(r.glm).toEqual({ mode: "MOCK", model: "custom-glm" });
  });
});
