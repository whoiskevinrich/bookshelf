#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { AuthStack, AuthPoolPhase, AUTH_POOL_PHASES } from "../lib/auth-stack";
import { ApiStack, ApiCustomDomainConfig } from "../lib/api-stack";
import { McpStack, McpCustomDomainConfig } from "../lib/mcp-stack";
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
 * Two environments — all same-origin (`/api/*` via CloudFront, no CORS):
 *   - `dev`  — domainless, invite-only. Mirrors prod's request topology on
 *              `*.cloudfront.net` (separate dev account).
 *   - `prod` — self-signup on + custom domain `bookshelf.whoiskevinrich.com`.
 */
interface EnvConfig {
  region: string;
  /** Cognito self-signup — off for dev (invite-only), on for full prod. */
  allowSelfSignUp: boolean;
  /**
   * Route the API through CloudFront `/api/*` (same-origin → no CORS). True for all
   * deployed environments. The false path keeps permissive CORS for a cross-origin
   * SPA (kept as a fallback for any future non-CloudFront setup).
   */
  apiThroughCloudFront: boolean;
  /** Custom domain subtree, e.g. "bookshelf.whoiskevinrich.com" (full prod only). */
  domain?: string;
  /**
   * Mobile camera ISBN scanner. Verified on a real phone against the dev
   * CloudFront URL (2026-06-13), then released to prod. On in both environments.
   */
  scannerEnabled: boolean;
  /**
   * Comma-separated email allowlist for the Cognito PreSignUp Lambda.
   * When set, only these emails can register or sign in (native or Google).
   * Omit for open enrollment.
   */
  googleEmailAllowlist?: string;
  /**
   * Steady-state Cognito pool phase for this environment (ADR-015). Both dev and prod completed
   * the blue/green migration (2026-06-13), so their steady state is `green`. A transient cutover
   * is driven by overriding `-c authPool=cutover` (and the consumers-first `green` deploy) during
   * the maintenance window — the override wins over this default, so routine CI deploys land on
   * the correct phase without a flag.
   */
  authPool: AuthPoolPhase;
}

const ENVIRONMENTS: Record<string, EnvConfig> = {
  dev: {
    region: "us-west-2",
    allowSelfSignUp: false,
    apiThroughCloudFront: true,
    googleEmailAllowlist: "whoiskevinrich@gmail.com",
    scannerEnabled: true,
    authPool: "green", // migrated 2026-06-13 (ADR-015)
  },
  prod: {
    region: "us-west-2",
    allowSelfSignUp: true,
    apiThroughCloudFront: true,
    domain: "bookshelf.whoiskevinrich.com",
    scannerEnabled: true,
    authPool: "green", // migrated 2026-06-13 (ADR-015)
  },
};

const app = new cdk.App();

// ── Environment selection ─────────────────────────────────────────────────
// -c env=dev|prod (default dev). Drives the entire topology.
const envName = (app.node.tryGetContext("env") as string | undefined) ?? "dev";
const config = ENVIRONMENTS[envName];
if (!config) {
  throw new Error(
    `Unknown env "${envName}". Valid values: ${Object.keys(ENVIRONMENTS).join(", ")}`,
  );
}

// Version is a per-deploy input (the active S3 prefix), not an environment trait.
const version = (app.node.tryGetContext("version") as string | undefined) ?? "local";

// Blue/green Cognito pool phase (ADR-015). Steady state comes from the env config; a maintenance
// window overrides it with `-c authPool=cutover|green`. The override wins so routine CI deploys
// (no flag) land on each environment's correct steady-state phase.
const authPoolOverride = app.node.tryGetContext("authPool") as string | undefined;
const authPool = authPoolOverride ?? config.authPool;
if (!AUTH_POOL_PHASES.includes(authPool as AuthPoolPhase)) {
  throw new Error(
    `Invalid -c authPool="${authPool}". Valid values: ${AUTH_POOL_PHASES.join(", ")}`,
  );
}
const poolPhase = authPool as AuthPoolPhase;

// Account stays ambient (from the assumed role); region comes from env config.
const account = process.env["CDK_DEFAULT_ACCOUNT"] ?? process.env["AWS_ACCOUNT_ID"];
const env: cdk.Environment = account
  ? { account, region: config.region }
  : { region: config.region };
// CloudFront certs must live in us-east-1, regardless of the other stacks' region.
const usEast1Env: cdk.Environment = account
  ? { account, region: "us-east-1" }
  : { region: "us-east-1" };

// `cloudfront-domain` is injected by CI after WebStack deploys (just the hostname,
// no scheme). Environments with a custom `domain` don't need it — their callback
// URL is derived from the domain name below.
const cloudfrontDomain = app.node.tryGetContext("cloudfront-domain") as string | undefined;

const oauthCallbackUrls = [
  ...(config.domain ? [`https://${config.domain}/auth/callback`] : []),
  ...(cloudfrontDomain ? [`https://${cloudfrontDomain}/auth/callback`] : []),
];
const oauthLogoutUrls = [
  ...(config.domain ? [`https://${config.domain}`] : []),
  ...(cloudfrontDomain ? [`https://${cloudfrontDomain}`] : []),
];

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
let cdnCert: CdnCertStack | undefined;
let webCustomDomain: WebCustomDomainConfig | undefined;
let apiCustomDomain: ApiCustomDomainConfig | undefined;
if (config.domain) {
  const wildcard = `*.${config.domain}`; // covers auth. api. mcp. and future subdomains

  dns = new DnsStack(app, "BookshelfDns", {
    env: usEast1Env,
    appSubdomain: config.domain,
  });

  cdnCert = new CdnCertStack(app, "BookshelfCdnCert", {
    env: usEast1Env,
    domainName: config.domain,
    subjectAlternativeNames: [wildcard],
    hostedZone: dns.hostedZone, // same-region ref; automated cert validation (ADR-013)
  });
  cdnCert.addDependency(dns);

  webCustomDomain = {
    certificate: cdnCert.certificate,
    webHostname: config.domain,
    hostedZoneName: config.domain,
  };
  apiCustomDomain = {
    apiHostname: `api.${config.domain}`,
    certificateDomainName: wildcard,
    hostedZoneName: config.domain,
  };
}

const auth = new AuthStack(app, "BookshelfAuth", {
  env,
  // crossRegionReferences required when consuming the us-east-1 CdnCertStack cert
  ...(cdnCert ? { crossRegionReferences: true } : {}),
  allowSelfSignUp: config.allowSelfSignUp,
  googleEmailAllowlist: config.googleEmailAllowlist,
  oauthCallbackUrls,
  oauthLogoutUrls,
  poolPhase,
  ...(config.domain && cdnCert
    ? {
        cognitoCustomDomain: {
          domainName: `auth.${config.domain}`,
          certificate: cdnCert.certificate,
          hostedZoneName: config.domain,
        },
      }
    : {}),
});

const api = new ApiStack(app, "BookshelfApi", {
  env,
  userPoolId: auth.userPoolId,
  userPoolIssuer: auth.userPoolIssuer,
  userPoolClientId: auth.userPoolClientId,
  mcpClientId: auth.mcpClientId,
  // During an ADR-015 cutover, also trust the legacy (gen1) pool so sessions minted before
  // the cutover keep working until they expire (≤1h). Undefined in legacy/green phases.
  secondaryIssuer: auth.legacyUserPoolIssuer,
  secondaryClientId: auth.legacyUserPoolClientId,
  sameOrigin: config.apiThroughCloudFront,
  ...(apiCustomDomain ? { customDomain: apiCustomDomain } : {}),
});

// mcpCustomDomain references api.regionalCertificate (the wildcard regional cert
// created by ApiStack), so it must be defined after api is instantiated.
const mcpCustomDomain: McpCustomDomainConfig | undefined = config.domain
  ? {
      mcpHostname: `mcp.${config.domain}`,
      certificate: api.regionalCertificate!,
      hostedZoneName: config.domain,
    }
  : undefined;

const mcp = new McpStack(app, "BookshelfMcp", {
  env,
  userPoolId: auth.userPoolId,
  userPoolIssuer: auth.userPoolIssuer,
  mcpClientId: auth.mcpClientId,
  hostedUiBaseUrl: auth.hostedUiBaseUrl,
  apiUrl: api.apiUrl,
  ...(mcpCustomDomain ? { customDomain: mcpCustomDomain } : {}),
});
if (dns) mcp.addDependency(dns);

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
    cognitoOauthDomain: auth.hostedUiDomain,
    apiBaseUrl: config.apiThroughCloudFront ? "/api" : api.apiUrl,
    featureScanner: config.scannerEnabled,
  },
});

// Ensure BookshelfDns is deployed before ApiStack/WebStack so their
// HostedZone.fromLookup synth-time queries find the zone.
if (dns) {
  api.addDependency(dns);
  web.addDependency(dns);
}

cdk.Tags.of(app).add("Project", "bookshelf");
cdk.Tags.of(app).add("Environment", envName);
cdk.Tags.of(app).add("Version", version);
