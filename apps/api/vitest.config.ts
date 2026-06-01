import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["**/node_modules/**", "test/smoke/**", "test/integration/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      exclude: ["test/smoke/**", "test/integration/**"],
    },
  },
});
