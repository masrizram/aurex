import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";

// Dashboard UI regression tests (jsdom): provider hierarchy, route render,
// auth guards. Terpisah dari vitest.config.ts root (node env, API/backend).
//
// DEDUPE: react/react-dom/react-router* HARUS resolve ke copy lokal
// apps/dashboard/node_modules (bukan root) — testing-library yang terpasang
// di sini me-resolve react lokal; react ganda = dispatcher null = crash
// palsu "Cannot read properties of null (reading 'useState')".
const local = (p: string) => fileURLToPath(new URL(`./node_modules/${p}`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      react: local("react"),
      "react-dom": local("react-dom"),
      "react-dom/client": local("react-dom/client"),
      "react-router": local("react-router"),
      "react-router-dom": local("react-router-dom"),
    },
  },
  test: {
    include: ["test/**/*.test.tsx"],
    environment: "jsdom",
    globals: false,
    setupFiles: ["./test/setup.ts"],
  },
});
