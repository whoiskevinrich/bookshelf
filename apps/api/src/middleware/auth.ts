import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Context, Next } from "hono";

// Lazily constructed — avoids fetching JWKS at cold start; reads env at call time for testability
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

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
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: process.env["COGNITO_ISSUER"],
      audience: process.env["COGNITO_CLIENT_ID"],
    });

    const sub = payload["sub"];
    if (typeof sub !== "string" || !sub) {
      return c.json({ error: "Invalid token: missing sub claim" }, 401);
    }

    c.set("auth", { userId: sub });
    await next();
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
}
