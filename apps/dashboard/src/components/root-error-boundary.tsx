import { Component, type ErrorInfo, type ReactNode } from "react";

// ═════════════════════════════════════════════════════════════════
// RootErrorBoundary — P1 hardening (§5 runtime stability).
// Lesson 2026-08-25: satu throw context (useSearch di luar provider)
// mem-blank seluruh SPA tanpa pesan. Boundary ini memastikan crash
// recoverable menampilkan fallback human-readable (bukan stack trace).
// Tidak dipasang per-route: cukup root — React unmount semua anak
// boundary ketika error terjadi; granular route-level menambah
// kompleksitas tanpa manfaat tambahan untuk SPA single-file ini.
// ═════════════════════════════════════════════════════════════════

type Props = { children: ReactNode };
type State = { hasError: boolean; message: string | null };

export class RootErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false, message: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message ?? null };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log teknis internal (console) — TIDAK ditampilkan ke customer.
    console.error("[AUREX] Uncaught UI error:", error?.message, info?.componentStack);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "12px",
            padding: "24px",
            fontFamily: "system-ui, -apple-system, sans-serif",
            color: "#0f172a",
            background: "#f8fafc",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0 }}>
            Terjadi kesalahan
          </h1>
          <p style={{ fontSize: "14px", color: "#475569", margin: 0, maxWidth: "420px" }}>
            AUREX tidak dapat memuat bagian ini. Data Anda aman — coba muat ulang
            halaman.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: "8px",
              padding: "8px 16px",
              fontSize: "14px",
              fontWeight: 500,
              borderRadius: "8px",
              border: "1px solid #cbd5e1",
              background: "#fff",
              cursor: "pointer",
            }}
          >
            Muat Ulang
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
