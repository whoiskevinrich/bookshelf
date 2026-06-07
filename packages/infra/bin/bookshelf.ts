#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { AuthStack } from "../lib/auth-stack";
import { ApiStack, ApiCustomDomainConfig } from "../lib/api-stack";
import { WebStack, WebCustomDomainConfig } from "../lib/web-stack";
import { CdnCertStack } from "../lib/cdn-cert-stack";

/**
 * Typed per-environment configuration.
 *
 * Selecting an environment with `-c env=…` applies ALL of its settings atomically
 * (ADR-009) — no separate `-c domain` / `-c allowSelfSignUp` to forget, so prod
 * can't silently deploy a weaker topology.
 *
 * `account` is NOT pinned here — it is resolved at deploy time from the OIDC-
 * assumed credentials (one AWS account per environment), keeping account IDs out
 * of source. `region` and the behavioural flags are environment traits.
 *
 * Three environments — all same-origin (`/api/*` via CloudFront, no CORS):
 *   - `dev`          — domainless, invite-only. Mirrors prod's request topology on
 *                      `*.cloudfront.net` (separate dev account).
 *   - `prod-interim` — domainless, invite-only. Live on `*.cloudfront.net` while the
 *                      custom domain is blocked at the registrar (ADR-010). No certs.
 *   - `prod`         — self-signup on + custom domain `bookshelf.whoiskevinrich.com`.
 */
interface EnvConfig {
  region: string;
  /** Cognito self-signup — off for dev/interim (invite-only), on for full prod. */
  allowSelfSignUp: boolean;
  /**
   * Route the API through CloudFront `/api/*` (same-origin → no CORS). True for all
   * deployed environments. The false path keeps permissive CORS for a cross-origin
   * SPA (kept as a fallback for any future non-CloudFront setup).
   */
  apiThroughCloudFront: boolean;
  /** Custom domain subtree, e.g. "bookshelf.whoiskevinrich.com" (full prod only). */
  domain?: string;
}

const ENVIRONMENTS: Record<string, EnvConfig> = {
  dev: {
    region: "us-west-2",
    allowSelfSignUp: false,
    apiThroughCloudFront: true,
  },
  "prod-interim": {
    region: "us-west-2",
    allowSelfSignUp: false,
    apiThroughCloudFront: true,
  },
  prod: {
    region: "us-west-2",
    allowSelfSignUp: true,
    apiThroughCloudFront: true,
    domain: "bookshelf.whoiskevinrich.com",
  },
};

const app = new cdk.App();

// ── Environment selection ─────────────────────────────────────────────────
// -c env=dev|prod-interim|prod (default dev). Drives the entire topology.
const envName = (app.node.tryGetContext("env") as string | undefined) ?? "dev";
const config = ENVIRONMENTS[envName];
if (!config) {
  throw new Error(
    `Unknown env "${envName}". Valid values: ${Object.keys(ENVIRONMENTS).join(", ")}`,
  );
}

// Version is a per-deploy input (the active S3 prefix), not an environment trait.
const version = (app.node.tryGetContext("version") as string | undefined) ?? "local";

// Account stays ambient (from the assumed role); region comes from env config.
const account = process.env["CDK_DEFAULT_ACCOUNT"] ?? process.env["AWS_ACCOUNT_ID"];
const env: cdk.Environment = account
  ? { account, region: config.region }
  : { region: config.region };
// CloudFront certs must live in us-east-1, regardless of the other stacks' region.
const usEast1Env: cdk.Environment = account
  ? { account, region: "us-east-1" }
  : { region: "us-east-1" };

const auth = new AuthStack(app, "BookshelfAuth", {
  env,
  allowSelfSignUp: config.allowSelfSignUp,
});

// ── Custom domain (full prod only) ──────────────────────────────────────────
// DNS lives at the registrar (Hover) — no Route53. Both ACM certs use manual DNS
// validation; public hostnames are CNAMEs → the CloudFront / API custom-domain
// names (stack outputs). See ADR-008 + docs/runbooks/prod-domain-setup.md.
let webCustomDomain: WebCustomDomainConfig | undefined;
let apiCustomDomain: ApiCustomDomainConfig | undefined;
if (config.domain) {
  const wildcard = `*.${config.domain}`; // covers api. and future www./mcp.
  const cdnCert = new CdnCertStack(app, "BookshelfCdnCert", {
    env: usEast1Env,
    domainName: config.domain, // subtree apex
    subjectAlternativeNames: [wildcard],
  });
  webCustomDomain = { certificate: cdnCert.certificate, webHostname: config.domain };
  apiCustomDomain = { apiHostname: `api.${config.domain}`, certificateDomainName: wildcard };
}

const api = new ApiStack(app, "BookshelfApi", {
  env,
  userPoolId: auth.userPoolId,
  userPoolIssuer: auth.userPoolIssuer,
  userPoolClientId: auth.userPoolClientId,
  sameOrigin: config.apiThroughCloudFront,
  ...(apiCustomDomain ? { customDomain: apiCustomDomain } : {}),
});

const web = new WebStack(app, "BookshelfWeb", {
  env,
  version,
  // crossRegionReferences only needed for the us-east-1 CloudFront cert (full prod).
  ...(webCustomDomain ? { crossRegionReferences: true, customDomain: webCustomDomain } : {}),
  ...(config.apiThroughCloudFront ? { apiOrigin: api.executeApiDomain } : {}),
  // Deploy-time runtime config (config.json) — from the stacks' readonly props, so
  // the web build needs no VITE_* env. /api when same-origin, else execute-api URL.
  runtimeConfig: {
    cognitoUserPoolId: auth.userPoolId,
    cognitoUserPoolClientId: auth.userPoolClientId,
    cognitoRegion: config.region,
    apiBaseUrl: config.apiThroughCloudFront ? "/api" : api.apiUrl,
  },
});

// Web must deploy after Auth (the web build bakes Cognito IDs) and, when the API
// is fronted via CloudFront, after the API (token ref also implies this).
web.addDependency(auth);
if (config.apiThroughCloudFront) {
  web.addDependency(api);
}

cdk.Tags.of(app).add("Project", "bookshelf");
cdk.Tags.of(app).add("Environment", envName);
cdk.Tags.of(app).add("Version", version);
