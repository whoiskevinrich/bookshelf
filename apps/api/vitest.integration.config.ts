import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/integration/**/*.test.ts"],
    testTimeout: 15000,
    env: {
      DYNAMODB_ENDPOINT: process.env["DYNAMODB_ENDPOINT"] ?? "http://127.0.0.1:8000",
      DYNAMODB_TABLE_NAME: process.env["DYNAMODB_TABLE_NAME"] ?? "bookshelf-integration-test",
    },
  },
});
