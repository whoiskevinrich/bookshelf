#!/usr/bin/env node
// QA guards — mechanical enforcement of the [auto] items in
// docs/runbooks/qa-checklist.md. Dependency-free; run via `pnpm qa:guards`
// (also part of `preflight`) and in CI (.github/workflows/pr.yml).
// Exits non-zero with file:line detail on any violation.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

// Tracked files only — naturally excludes node_modules and gitignored paths,
// and is cross-platform (git prints forward-slash paths on Windows too).
// execFileSync (no shell) avoids any command-injection surface.
const trackedFiles = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n")
  .map((f) => f.trim())
  .filter(Boolean);

/** @type {{check: string, file: string, line: number, message: string}[]} */
const violations = [];
const fail = (check, file, line, message) => violations.push({ check, file, line, message });

const linesOf = (file) => {
  try {
    return readFileSync(file, "utf8").split(/\r?\n/);
  } catch {
    return null;
  }
};

// Flag every line containing any of `needles` (plain substring, not regex).
const scanForTokens = (file, needles, check, label) => {
  const ls = linesOf(file);
  if (!ls) return;
  ls.forEach((text, i) => {
    const hit = needles.find((n) => text.includes(n));
    if (hit) fail(check, file, i + 1, `${label}: \`${hit}\``);
  });
};

const inSrc = (prefixes, exts) => (f) =>
  prefixes.some((p) => f.startsWith(p)) && exts.some((e) => f.endsWith(e));

// 1. Auth coverage — every route router applies auth at the router level.
const isApiRoute = (f) =>
  /^apps\/api\/src\/routes\/[^/]+\.ts$/.test(f) && !f.endsWith("/_utils.ts");
for (const f of trackedFiles.filter(isApiRoute)) {
  if (!readFileSync(f, "utf8").includes('.use("*", authMiddleware)')) {
    fail(
      "auth-coverage",
      f,
      1,
      'route file must apply auth at the router level: router.use("*", authMiddleware)',
    );
  }
}

// 2. Body limit — the global bodyLimit middleware must stay in the API entry.
{
  const f = "apps/api/src/app.ts";
  const content = linesOf(f)?.join("\n");
  if (content != null && !content.includes("bodyLimit(")) {
    fail("body-limit", f, 1, "global bodyLimit middleware is missing from app.ts");
  }
}

// 3. No auth bypass (NON-NEGOTIABLE) — no mock/stub auth anywhere in app source.
const bypassTokens = ["VITE_MOCK_API", "MOCK_MODE", "dev:mock", "mocks/browser"];
const appSource = trackedFiles.filter(
  inSrc(["apps/api/src/", "apps/web/src/", "apps/mcp/src/"], [".ts", ".tsx"]),
);
const appManifests = ["apps/api/package.json", "apps/web/package.json", "apps/mcp/package.json"];
for (const f of [...appSource, ...appManifests]) {
  scanForTokens(f, bypassTokens, "auth-bypass", "mock/stub auth bypass token");
}

// 4. No committed env files (NON-NEGOTIABLE) — only *.example may be tracked.
for (const f of trackedFiles) {
  const base = f.split("/").pop() ?? "";
  if (/^\.env(\..+)?$/.test(base) && !base.endsWith(".example")) {
    fail("committed-env", f, 1, "env files must be gitignored; commit only .env.example");
  }
}

// 5. No local ISBN digit-checks — use isValidIsbn/normalizeIsbn from lib/isbn.ts.
const isbnShapes = ["\\d{10}", "\\d{13}", "\\d{9}"];
const apiTs = trackedFiles.filter(
  (f) => /^apps\/api\/src\/.+\.ts$/.test(f) && f !== "apps/api/src/lib/isbn.ts",
);
for (const f of apiTs) {
  scanForTokens(f, isbnShapes, "isbn-local-regex", "local ISBN digit-check (use lib/isbn.ts)");
}

// 6. UI guards — banned button colors / low-contrast muted text in the web app.
const bannedClasses = ["text-gray-400", "bg-indigo-600", "bg-gray-900"];
for (const f of trackedFiles.filter(inSrc(["apps/web/src/"], [".ts", ".tsx"]))) {
  scanForTokens(f, bannedClasses, "ui-classes", "banned Tailwind class");
}

// 7. No console.log in production code (console.error/warn are allowed for
// server-side logging). The local dev-server entrypoints (server.ts) are exempt.
const consoleTokens = ["console.log", "console.info", "console.debug"];
const prodSource = trackedFiles.filter(
  (f) =>
    inSrc(["apps/api/src/", "apps/web/src/", "apps/mcp/src/"], [".ts", ".tsx"])(f) &&
    !f.endsWith("/server.ts"),
);
for (const f of prodSource) {
  scanForTokens(f, consoleTokens, "no-console", "use console.error/warn, not");
}

// Report.
if (violations.length === 0) {
  console.log("qa-guards: all checks passed");
  process.exit(0);
}

const byCheck = new Map();
for (const v of violations) {
  if (!byCheck.has(v.check)) byCheck.set(v.check, []);
  byCheck.get(v.check).push(v);
}
console.error(`qa-guards: ${violations.length} violation(s) found\n`);
for (const [check, vs] of byCheck) {
  console.error(`[${check}]`);
  for (const v of vs) console.error(`  ${v.file}:${v.line}  ${v.message}`);
  console.error("");
}
console.error("See docs/runbooks/qa-checklist.md for the rule behind each check.");
process.exit(1);
