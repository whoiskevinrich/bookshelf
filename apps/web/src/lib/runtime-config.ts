/**
 * Runtime configuration for the SPA.
 *
 * Deployed builds fetch `/config.json` — written to S3 by the CDK `WebStack` from
 * the Auth/API stacks' public properties at **deploy** time. So the production
 * bundle bakes in NO environment-specific values, and the same artifact works in
 * any environment without `VITE_*` build vars.
 *
 * Local `vite dev` has no `/config.json`, so it falls back to Vite build-time env
 * vars (`apps/web/.env.local`). Auth always targets the real Cognito pool — this
 * is configuration, not a mock.
 */
export interface RuntimeConfig {
  cognito: {
    userPoolId: string;
    userPoolClientId: string;
    region: string;
  };
  /** "/api" (same-origin via CloudFront) or an absolute execute-api URL (dev). */
  apiBaseUrl: string;
}

let cached: RuntimeConfig | undefined;

/**
 * Synchronous accessor. After `loadRuntimeConfig()` resolves, returns the loaded
 * config (`/config.json` in deployed builds). If called before that — local dev,
 * unit tests — it lazily falls back to build-time env vars rather than throwing.
 */
export function getRuntimeConfig(): RuntimeConfig {
  if (!cached) {
    cached = fromEnv();
  }
  return cached;
}

function fromEnv(): RuntimeConfig {
  return {
    cognito: {
      userPoolId: (import.meta.env.VITE_COGNITO_USER_POOL_ID as string | undefined) ?? "",
      userPoolClientId: (import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined) ?? "",
      region: (import.meta.env.VITE_COGNITO_REGION as string | undefined) ?? "us-west-2",
    },
    apiBaseUrl: (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "",
  };
}

/**
 * Load runtime config: prefer the deployed `/config.json`, fall back to build-time
 * env vars for local dev. Call once at startup, before configuring Amplify and
 * before any API call.
 */
export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  try {
    const res = await fetch("/config.json", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as RuntimeConfig;
      // Guard against a dev server returning index.html for a missing file.
      if (data?.cognito?.userPoolId) {
        cached = data;
        return cached;
      }
    }
  } catch {
    // No /config.json (local dev) — fall through to env.
  }
  cached = fromEnv();
  return cached;
}
