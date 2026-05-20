import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import json from "@eslint/json";
import markdown from "@eslint/markdown";
import css from "@eslint/css";
import defineConfig from "../../eslint.config.base.mts";

export default defineConfig([
 { extends: [defineConfig]}
]);
