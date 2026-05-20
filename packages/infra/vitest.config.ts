import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // cdk.out/.ts/ is the TypeScript compiler output — exclude it from test
    // discovery so vitest only runs the original source test files.
    exclude: ['cdk.out/**', 'node_modules/**'],
  },
});
