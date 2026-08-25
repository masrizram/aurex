import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Build dashboard React → packages/api/assets/index.html (single file);
// npm run build kemudian me-rename ke dashboard.html — artefak yang
// di-serve oleh route /app/* di packages/api/src/index.ts.
// NOTE: plugin @tailwindcss/vite WAJIB — Tailwind v4 bekerja via plugin
// Vite (bukan PostCSS). Tanpa ini, @import 'tailwindcss' hanya
// ter-inline mentah tanpa scan utility → semua halaman kehilangan CSS.
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "../../packages/api/assets",
    emptyOutDir: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 10_000,
  },
});
