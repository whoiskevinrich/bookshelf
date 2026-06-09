import { createRemoteJWKSet, jwtVerify } from "jose";

// Lazily constructed — same pattern as apps/api/src/middleware/auth.ts
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

export async function verifyToken(token: string): Promise<AuthContext> {
  const issuer = process.env["COGNITO_ISSUER"];
  const audience = process.env["COGNITO_CLIENT_ID"];
  if (!audience) throw new Error("COGNITO_CLIENT_ID is not set");

  const { payload } = await jwtVerify(token, getJwks(), {
    ...(issuer ? { issuer } : {}),
    audience,
  });

  const tokenUse = payload["token_use"];
  if (tokenUse !== "id") {
    throw new Error("Invalid token: expected id token");
  }

  const sub = payload["sub"];
  if (typeof sub !== "string" || !sub) {
    throw new Error("Invalid token: missing sub claim");
  }

  return { userId: sub };
}
