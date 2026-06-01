import baseConfig from "../../eslint.config.base.mts";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
  // Tailwind's entry point uses @custom-variant (non-standard at-rule) — exclude from CSS linting
  { ignores: ["src/index.css"] },
  ...baseConfig,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
]);
