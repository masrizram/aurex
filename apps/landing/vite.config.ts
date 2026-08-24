import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Build landing → satu file HTML ke packages/api/assets/.
// Vite emits index.html; run postbuild rename to landing.html via npm script.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    outDir: "../../packages/api/assets",
    emptyOutDir: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 10_000,
  },
});
