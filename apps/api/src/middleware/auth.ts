import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Context, Next } from "hono";

// Lazily constructed — avoids fetching JWKS at cold start; reads env at call time for testability
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function parseGoogleIdentity(identities: unknown): boolean {
  if (!identities) return false;
  try {
    const arr =
      typeof identities === "string" ? (JSON.parse(identities) as unknown) : identities;
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

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!jwks) {
    const issuer = process.env["COGNITO_ISSUER"];
    if (!issuer) throw new Error("COGNITO_ISSUER is not set");
    jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  }
  return jwks;
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
    const issuer = process.env["COGNITO_ISSUER"];
    const audience = process.env["COGNITO_CLIENT_ID"];
    const { payload } = await jwtVerify(token, getJwks(), {
      ...(issuer ? { issuer } : {}),
      ...(audience ? { audience } : {}),
    });

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
