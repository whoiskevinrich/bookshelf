import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/smoke/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    testTimeout: 15000,
  },
});
