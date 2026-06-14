import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Context, Next } from "hono";

// One JWKS set per issuer, lazily constructed — avoids fetching JWKS at cold start; the cache is
// keyed by issuer URL so a blue/green cutover (primary + secondary pool, ADR-015) keeps both.
const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function parseGoogleIdentity(identities: unknown): boolean {
  if (!identities) return false;
  try {
    const arr = typeof identities === "string" ? (JSON.parse(identities) as unknown) : identities;
    if (!Array.isArray(arr)) return false;
    return arr.some(
      (id) =>
        typeof id === "object" &&
        id !== null &&
        (id as Record<string, unknown>)["providerType"] === "Google",
    );
  } catch {
    return false;
  }
}

function getJwks(issuer: string): ReturnType<typeof createRemoteJWKSet> {
  let set = jwksByIssuer.get(issuer);
  if (!set) {
    set = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    jwksByIssuer.set(issuer, set);
  }
  return set;
}

/**
 * Issuers this API trusts, in priority order. Normally just `COGNITO_ISSUER`; during an
 * ADR-015 blue/green cutover `COGNITO_ISSUER_SECONDARY` is also set so tokens from the old
 * pool keep validating until they expire. Read at call time for testability.
 */
/** Keep only the set (non-empty) values — used to collect optional env vars into a list. */
function present(...values: (string | undefined)[]): string[] {
  return values.filter((v): v is string => !!v);
}

function trustedIssuers(): string[] {
  return present(process.env["COGNITO_ISSUER"], process.env["COGNITO_ISSUER_SECONDARY"]);
}

export interface AuthContext {
  userId: string;
  /** Cognito username (email for this pool) — required for admin API calls like AdminDeleteUser */
  cognitoUsername: string;
  /** True when the session was established via Google OAuth (checked via identities JWT claim). */
  isGoogleUser: boolean;
}

declare module "hono" {
  interface ContextVariableMap {
    auth: AuthContext;
  }
}

export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const token = authHeader.slice(7);
  try {
    // The API is a shared resource server: it trusts the web SPA client and the MCP app
    // client (and, during an ADR-015 cutover, the legacy pool's SPA client). jose accepts an
    // audience array — a token is valid if its `aud` matches any entry. The clients stay
    // separate so MCP access can be revoked independently of the web app.
    const audience = present(
      process.env["COGNITO_CLIENT_ID"],
      process.env["COGNITO_MCP_CLIENT_ID"],
      process.env["COGNITO_CLIENT_ID_SECONDARY"],
    );

    // Verify against each trusted issuer in turn (two only during a cutover). Each pool has
    // its own JWKS, so any given token validates against exactly one issuer.
    let payload: JWTPayload | undefined;
    for (const issuer of trustedIssuers()) {
      try {
        ({ payload } = await jwtVerify(token, getJwks(issuer), {
          issuer,
          ...(audience.length > 0 ? { audience } : {}),
        }));
        break;
      } catch {
        // Not this issuer — fall through to the next trusted pool, if any.
      }
    }

    if (!payload) {
      return c.json({ error: "Invalid or expired token" }, 401);
    }

    // Reject access tokens — only Cognito ID tokens are accepted here.
    // ID tokens carry identity claims (sub, cognito:username, email) while
    // access tokens only carry scopes; accepting access tokens would allow
    // API calls with a token type never intended for resource authorization.
    const tokenUse = payload["token_use"];
    if (tokenUse !== "id") {
      return c.json({ error: "Invalid token: expected id token" }, 401);
    }

    const sub = payload["sub"];
    if (typeof sub !== "string" || !sub) {
      return c.json({ error: "Invalid token: missing sub claim" }, 401);
    }

    const cognitoUsername = payload["cognito:username"];
    if (typeof cognitoUsername !== "string" || !cognitoUsername) {
      return c.json({ error: "Invalid token: missing cognito:username claim" }, 401);
    }

    // Detect Google-federated sessions via the identities claim Cognito embeds in ID tokens.
    // Using the JWT claim (not cognitoUsername prefix) handles linked accounts correctly —
    // linked accounts keep the native username (email) but still have identities populated.
    const isGoogleUser = parseGoogleIdentity(payload["identities"]);

    c.set("auth", { userId: sub, cognitoUsername, isGoogleUser });
    await next();
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
}
