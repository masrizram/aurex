import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@aee/domain": fileURLToPath(new URL("./packages/domain/src/index.ts", import.meta.url)),
      "@aee/money": fileURLToPath(new URL("./packages/money/src/index.ts", import.meta.url)),
      "@aee/contracts": fileURLToPath(new URL("./packages/contracts/src/index.ts", import.meta.url)),
      "@aee/economics": fileURLToPath(new URL("./packages/economics/src/index.ts", import.meta.url)),
      "@aee/orchestrator/runtime": fileURLToPath(new URL("./packages/orchestrator/src/runtime.ts", import.meta.url)),
      "@aee/orchestrator/mission-manager": fileURLToPath(new URL("./packages/orchestrator/src/mission-manager.ts", import.meta.url)),
      "@aee/orchestrator/result-processor": fileURLToPath(new URL("./packages/orchestrator/src/result-processor.ts", import.meta.url)),
      "@aee/orchestrator": fileURLToPath(new URL("./packages/orchestrator/src/index.ts", import.meta.url)),
      "@aee/api": fileURLToPath(new URL("./packages/api/src/index.ts", import.meta.url)),
      "@aee/db": fileURLToPath(new URL("./packages/db/src/index.ts", import.meta.url)),
      "@aee/agents": fileURLToPath(new URL("./packages/agents/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["apps/*/test/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    environment: "node",
  },
});
