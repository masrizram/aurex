import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Build dashboard React → satu file HTML ke packages/api/assets/index.html.
// Post-build: copy ke dashboard.html (dipakai route GET /).
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "../../packages/api/assets",
    emptyOutDir: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 10_000,
  },
});
