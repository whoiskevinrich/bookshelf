#!/usr/bin/env node
/**
 * Web smoke check (BOOKSHELF-111) — does the deployed SPA actually serve?
 *
 * The API smoke (`apps/api` test:smoke) never touches CloudFront/S3, so prod's web
 * front end returned S3 AccessDenied for 6½ weeks unnoticed (BOOKSHELF-109). This
 * checks the web origin itself:
 *   - `/` and `/shelf` (a client route, served via the SPA 403/404 → index.html
 *     fallback) return 200 and contain the React mount point `<div id="root"`;
 *   - `/config.json` returns 200, parses, and names a Cognito user pool — the exact
 *     pool when EXPECTED_USER_POOL_ID is given.
 *
 * Env:
 *   WEB_BASE_URL          required, e.g. https://bookshelf.whoiskevinrich.com
 *   EXPECTED_USER_POOL_ID optional, e.g. us-west-2_AbC123 (deploy workflows pass the
 *                         BookshelfAuth output; the daily uptime check omits it)
 *   SMOKE_ATTEMPTS        optional, default 3 — retries absorb CloudFront
 *                         invalidation lag right after a deploy
 *   SMOKE_RETRY_DELAY_MS  optional, default 10000
 *
 * Exits 1 (after the last attempt) if any check fails. Zero-dependency.
 */

import { pathToFileURL } from "node:url";

const ROOT_MARKER = '<div id="root"';
const POOL_ID_PATTERN = /^[a-z]{2}-[a-z]+-\d_[A-Za-z0-9]+$/;

/** Run every check once; returns a list of human-readable failures (empty = pass). */
export async function checkSite({ baseUrl, expectedUserPoolId, fetchImpl = fetch }) {
  const base = baseUrl.replace(/\/$/, "");
  const failures = [];

  async function get(path) {
    try {
      const res = await fetchImpl(`${base}${path}`, { redirect: "follow" });
      return { status: res.status, body: await res.text() };
    } catch (err) {
      failures.push(`GET ${path} → request failed: ${err.message}`);
      return null;
    }
  }

  for (const path of ["/", "/shelf"]) {
    const res = await get(path);
    if (!res) continue;
    if (res.status !== 200) failures.push(`GET ${path} → ${res.status} (expected 200)`);
    else if (!res.body.includes(ROOT_MARKER)) failures.push(`GET ${path} → missing ${ROOT_MARKER}`);
  }

  const cfg = await get("/config.json");
  const cfgFailure = cfg && checkConfig(cfg, expectedUserPoolId);
  if (cfgFailure) failures.push(cfgFailure);

  return failures;
}

/** Validate the /config.json response; returns a failure string or null. */
function checkConfig({ status, body }, expectedUserPoolId) {
  if (status !== 200) return `GET /config.json → ${status} (expected 200)`;
  let poolId;
  try {
    poolId = JSON.parse(body)?.cognito?.userPoolId;
  } catch {
    return "GET /config.json → body is not valid JSON";
  }
  if (expectedUserPoolId && poolId !== expectedUserPoolId) {
    return `config.json cognito.userPoolId is ${JSON.stringify(poolId)} (expected ${expectedUserPoolId})`;
  }
  if (!POOL_ID_PATTERN.test(String(poolId))) {
    return `config.json cognito.userPoolId is ${JSON.stringify(poolId)} (not a pool id)`;
  }
  return null;
}

async function main() {
  const baseUrl = process.env.WEB_BASE_URL;
  if (!baseUrl) {
    process.stderr.write("WEB_BASE_URL is required\n");
    process.exit(2);
  }
  const expectedUserPoolId = process.env.EXPECTED_USER_POOL_ID || undefined;
  const attempts = Number(process.env.SMOKE_ATTEMPTS ?? 3);
  const delayMs = Number(process.env.SMOKE_RETRY_DELAY_MS ?? 10_000);

  let failures = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    failures = await checkSite({ baseUrl, expectedUserPoolId });
    if (failures.length === 0) {
      process.stdout.write(`Web smoke passed: ${baseUrl} (attempt ${attempt}/${attempts})\n`);
      return;
    }
    process.stdout.write(`Attempt ${attempt}/${attempts} failed:\n  ${failures.join("\n  ")}\n`);
    if (attempt < attempts) await new Promise((r) => setTimeout(r, delayMs));
  }
  for (const f of failures) process.stdout.write(`::error::Web smoke: ${f}\n`);
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
