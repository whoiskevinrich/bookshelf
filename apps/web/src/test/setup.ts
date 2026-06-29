/**
 * Vitest setup — runs once before every test file (wired via `setupFiles` in
 * vitest.config.ts).
 *
 * - Extends `expect` with jest-dom matchers (`toBeInTheDocument`, `toHaveClass`,
 *   `toBeVisible`, …) and registers their TypeScript augmentation.
 * - Unmounts React trees and clears jsdom between tests so component state never
 *   leaks across cases.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
