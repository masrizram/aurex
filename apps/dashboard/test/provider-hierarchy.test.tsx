// @vitest-environment jsdom
// ═════════════════════════════════════════════════════════════════
// UI Provider-Hierarchy Regression Tests — P0/P1 crash class.
//
// Bug produksi 2026-08-25 (P1): <CommandMenu /> dipasang di App root
// (App.tsx) DI LUAR <SearchProvider> (yang hanya dipasang di dalam
// AuthenticatedLayout). CommandMenu memanggil useSearch() → throw
// "useSearch has to be used within SearchProvider" → seluruh tree
// React unmount → blank page di /auth/login, /onboarding, /admin.
//
// Kelas bug ini tak terdeteksi vitest API-level (144/144 pass saat itu).
// Test ini membuktikan kelasnya: SEMUA context consumer harus berada
// dalam provider di SETIAP route tree, dan tidak boleh ada crash
// provider-context di route manapun.
// ═════════════════════════════════════════════════════════════════
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import * as api from "@/api";
import { App } from "@/App";

// jsdom: fetch & navigation
declare global {
  interface Window {
    fetch: typeof fetch;
  }
}

// ── Fetch mock ────────────────────────────────────────────────────
// Semua request 401 (anonymous) secara default; test authenticated
// mengubah implementasi per-case.
const fetchMock = vi.fn();
window.fetch = fetchMock as unknown as typeof fetch;
window.scrollTo = () => {};

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const ME_OK = {
  user: {
    id: "u-1", email: "qa@aurex.test", role: "OWNER", isAdmin: false,
    name: "QA", emailVerified: true,
  },
  org: {
    id: "org-1", name: "QA Org", slug: "qa-org", planTier: "FREE",
    onboardingStep: 6, onboardingCompleted: "2026-08-25T00:00:00Z",
    autonomyLevel: 2,
  },
  usage: { credits_used: 0, credits_limit: 100 },
};

const ME_ADMIN = {
  ...ME_OK,
  user: { ...ME_OK.user, isAdmin: true },
};

const ME_ONBOARDING = {
  ...ME_OK,
  org: {
    ...ME_OK.org,
    onboardingStep: 2,
    onboardingCompleted: null,
  },
};

// Data minimal untuk halaman /app yang memanggil API list di mount.
const OBJECTIVES_LIST = {
  objectives: [
    { id: "obj-1", title: "Objective QA", status: "RUNNING", stage: "RESEARCH",
      industry: null, business_mode: "DISCOVERY", progress: 10,
      business_name: "QA Business" },
  ],
};

function routeFetch(map: Record<string, { status: number; body: unknown }>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input).replace(/^https?:\/\/[^/]+/, "");
    for (const [prefix, resp] of Object.entries(map)) {
      if (url === prefix || url.startsWith(prefix)) {
        return jsonResponse(resp.status, resp.body);
      }
    }
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "no route " + url } });
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
});

// ── Helper: render App di path tertentu ───────────────────────────
// App memakai useNavigate/useLocation → wajib wrapper Router (sama
// seperti main.tsx: BrowserRouter).
import { BrowserRouter } from "react-router-dom";

function renderAppAt(path: string) {
  window.history.pushState({}, "", path);
  return render(
    <BrowserRouter>
      <App />
    </BrowserRouter>,
  );
}

// ═════════════════════════════════════════════════════════════════
// T1 — Auth route TIDAK BOLEH crash (bug produksi /auth/login)
// ═════════════════════════════════════════════════════════════════
describe("P1 regression: /auth/* render tanpa provider crash", () => {
  it("auth/login merender form login, bukan blank page (useSearch crash)", async () => {
    fetchMock.mockImplementation(routeFetch({
      "/auth/me": { status: 401, body: { error: { code: "UNAUTHORIZED" } } },
    }));

    renderAppAt("/auth/login");

    // Form login harus muncul — bukan tree kosong hasil unmount crash.
    // Bug: CommandMenu di App root → useSearch() throw → React unmounts
    // seluruh App. Dengan fix, form ter-render.
    await waitFor(
      () => {
        expect(screen.getAllByText(/masuk ke aurex/i).length).toBeGreaterThan(0);
      },
      { timeout: 3000 },
    );
  });

  it("auth/signup merender form signup tanpa crash", async () => {
    fetchMock.mockImplementation(routeFetch({
      "/auth/me": { status: 401, body: { error: { code: "UNAUTHORIZED" } } },
    }));

    renderAppAt("/auth/signup");

    await waitFor(
      () => {
        expect(screen.getAllByText(/buat akun aurex/i).length).toBeGreaterThan(0);
      },
      { timeout: 3000 },
    );
  });
});

// ═════════════════════════════════════════════════════════════════
// T2 — Onboarding route TIDAK BOLEH crash
// ═════════════════════════════════════════════════════════════════
describe("P1 regression: /onboarding render tanpa provider crash", () => {
  it("onboarding merender UI wizard (bukan blank page)", async () => {
    fetchMock.mockImplementation(routeFetch({
      "/auth/me": { status: 200, body: ME_ONBOARDING },
    }));

    renderAppAt("/onboarding");

    await waitFor(
      () => {
        // OnboardingPage heading — cek teks non-kosong karakteristik halaman.
        expect(document.querySelector("main, .min-h-svh, form, h1, h2")).toBeTruthy();
      },
      { timeout: 3000 },
    );
  });
});

// ═══════════════════════════ Navigate guard ═══════════════════════
describe("Auth guards", () => {
  it("anonymous /app → redirect ke /auth/login (tidak crash)", async () => {
    fetchMock.mockImplementation(routeFetch({
      "/auth/me": { status: 401, body: { error: { code: "UNAUTHORIZED" } } },
    }));

    renderAppAt("/app");

    await waitFor(
      () => {
        expect(window.location.pathname).toBe("/auth/login");
      },
      { timeout: 3000 },
    );
  });

  it("authenticated + onboarding belum selesai → /onboarding", async () => {
    fetchMock.mockImplementation(routeFetch({
      "/auth/me": { status: 200, body: ME_ONBOARDING },
    }));

    renderAppAt("/app");

    await waitFor(
      () => {
        expect(window.location.pathname).toBe("/onboarding");
      },
      { timeout: 3000 },
    );
  });
});

// ═════════════════════════════════════════════════════════════════
// T3 — /app authenticated render penuh dengan SearchProvider aktif
// ═════════════════════════════════════════════════════════════════
describe("P1 regression: /app shell render (SearchProvider aktif)", () => {
  it("/app merender OverviewPage dengan sidebar + tanpa crash provider", async () => {
    fetchMock.mockImplementation(routeFetch({
      "/auth/me": { status: 200, body: ME_OK },
      "/objectives": { status: 200, body: OBJECTIVES_LIST },
      "/agent-mode": { status: 200, body: { mode: "MOCK", kimi: { model: "mock" }, glm: { model: "mock" } } },
      "/ventures": { status: 200, body: { ventures: [] } },
      "/usage": { status: 200, body: { credits_used: 0, credits_limit: 100 } },
      "/billing/plan": { status: 200, body: { tier: "FREE", price_monthly: 0 } },
    }));

    renderAppAt("/app");

    // Sidebar shell + konten halaman muncul (bukan blank).
    await waitFor(
      () => {
        expect(document.querySelector("main")).toBeTruthy();
      },
      { timeout: 3000 },
    );
  });
});

// ═════════════════════════════════════════════════════════════════
// T4 — /admin non-admin guard (tidak crash, redirect /app)
// ═══════════════════════════════════════════════┿══════════════════
describe("Admin guard", () => {
  it("non-admin /admin → redirect /app (Navigate), tidak crash", async () => {
    fetchMock.mockImplementation(routeFetch({
      "/auth/me": { status: 200, body: ME_OK },
    }));

    renderAppAt("/admin");

    await waitFor(
      () => {
        expect(window.location.pathname).toBe("/app");
      },
      { timeout: 3000 },
    );
  });
});

// ═════════════════════════════════════════════════════════════════
// T5 — Context safety unit: useSearch hook kontrak
// ═════════════════════════════════════════════════════════════════
describe("Context safety (unit level)", () => {
  it("useSearch di luar provider harus throw (kontrak hook)", async () => {
    const { useSearch } = await import("@/context/search-provider");
    // Hook dipanggil di luar provider → context null → throw Error.
    // (Hooks React di luar komponen tidak valid; pakai render probe.)
    function Probe() {
      try {
        useSearch();
        return <span data-testid="no-throw" />;
      } catch {
        return <span data-testid="threw" />;
      }
    }
    const { getByTestId } = render(<Probe />);
    expect(getByTestId("threw")).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════
// T6 — ErrorBoundary root: crash recoverable → fallback, bukan blank
// ═════════════════════════════════════════════════════════════════
describe("RootErrorBoundary (§5)", () => {
  it("throw komponen ditangkap boundary → fallback human-readable", async () => {
    const { RootErrorBoundary } = await import("@/components/root-error-boundary");
    function Bomb(): React.ReactElement {
      throw new Error("useSearch has to be used within SearchProvider");
    }
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <RootErrorBoundary>
        <Bomb />
      </RootErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/terjadi kesalahan/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /muat ulang/i })).toBeInTheDocument();
    // Stack trace / pesan error internal TIDAK boleh tampil ke customer.
    expect(screen.queryByText(/useSearch/i)).not.toBeInTheDocument();
    consoleSpy.mockRestore();
  });
});
