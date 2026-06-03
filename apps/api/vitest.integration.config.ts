import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/integration/**/*.test.ts"],
    testTimeout: 15000,
    env: {
      DYNAMODB_TABLE_NAME: process.env["DYNAMODB_TABLE_NAME"] ?? "bookshelf-integration-test",
    },
  },
});
