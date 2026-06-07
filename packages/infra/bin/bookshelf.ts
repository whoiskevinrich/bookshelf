#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { AuthStack } from "../lib/auth-stack";
import { ApiStack, ApiCustomDomainConfig } from "../lib/api-stack";
import { WebStack, WebCustomDomainConfig } from "../lib/web-stack";
import { CdnCertStack } from "../lib/cdn-cert-stack";
import { DnsStack } from "../lib/dns-stack";

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
// Two-tier DNS (ADR-012 + ADR-013): Cloudflare owns the apex zone and holds a
// single NS delegation record pointing the bookshelf subtree at DnsStack's
// Route53 hosted zone. CDK manages all records — cert validation CNAMEs,
// CloudFront alias, API Gateway alias — automatically after a one-time bootstrap.
//
// Bootstrap (once): cdk deploy BookshelfDns → capture 4 NS values from output
// → add NS record at Cloudflare → wait for propagation → cdk deploy --all.
// After bootstrap, cdk deploy --all is fully hands-free.
//
// Note: ApiStack and WebStack call HostedZone.fromLookup at synth time (Route53
// is a global API; no regional affinity). The zone must exist before the first
// cdk synth of those stacks. Result cached in cdk.context.json — commit this file.
let dns: DnsStack | undefined;
let webCustomDomain: WebCustomDomainConfig | undefined;
let apiCustomDomain: ApiCustomDomainConfig | undefined;
if (config.domain) {
  const wildcard = `*.${config.domain}`; // covers api. and future www./mcp.

  dns = new DnsStack(app, "BookshelfDns", {
    env: usEast1Env,
    appSubdomain: config.domain,
  });

  const cdnCert = new CdnCertStack(app, "BookshelfCdnCert", {
    env: usEast1Env,
    domainName: config.domain,
    subjectAlternativeNames: [wildcard],
    hostedZone: dns.hostedZone, // same-region ref; automated cert validation (ADR-013)
  });
  cdnCert.addDependency(dns);

  webCustomDomain = {
    certificate: cdnCert.certificate,
    webHostname: config.domain,
    hostedZoneName: config.domain, // Route53 A-alias record for CloudFront
  };
  apiCustomDomain = {
    apiHostname: `api.${config.domain}`,
    certificateDomainName: wildcard,
    hostedZoneName: config.domain, // automated cert validation + API Gateway alias
  };
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
// Ensure BookshelfDns is deployed before ApiStack/WebStack so their
// HostedZone.fromLookup synth-time queries find the zone.
if (dns) {
  api.addDependency(dns);
  web.addDependency(dns);
}

cdk.Tags.of(app).add("Project", "bookshelf");
cdk.Tags.of(app).add("Environment", envName);
cdk.Tags.of(app).add("Version", version);
