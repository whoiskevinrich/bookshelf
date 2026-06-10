import { Hono } from "hono";
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  AdminDeleteUserCommand,
  NotAuthorizedException,
  LimitExceededException,
  UserNotFoundException,
} from "@aws-sdk/client-cognito-identity-provider";
import { authMiddleware } from "../middleware/auth.js";
import { deleteAllUserData } from "../lib/dynamo.js";

const cognitoClient = new CognitoIdentityProviderClient({});
// Read at module scope — same pattern as TABLE_NAME in dynamo.ts.
// A missing pool ID is a deploy-time misconfiguration, not a per-request condition.
const userPoolId = process.env["COGNITO_USER_POOL_ID"];
const clientId = process.env["COGNITO_CLIENT_ID"];

export const usersRouter = new Hono();

usersRouter.use("*", authMiddleware);

// DELETE /v1/users/me — verify password, purge all shelf data, delete Cognito account.
// Password re-auth prevents a stolen token (valid up to 1h) from deleting the account.
usersRouter.delete("/me", async (c) => {
  const { userId, cognitoUsername, isGoogleUser } = c.get("auth");

  if (!userPoolId || !clientId) {
    return c.json({ error: "Server misconfiguration" }, 500);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (isGoogleUser) {
    // Google-federated users have no Cognito password; require typed confirmation instead.
    const confirmation = (body as Record<string, unknown>)?.["confirmation"];
    if (typeof confirmation !== "string" || confirmation !== "DELETE") {
      return c.json({ error: 'Type "DELETE" to confirm account deletion' }, 400);
    }
  } else {
    // Verify the current password before proceeding with deletion.
    // cognitoUsername is the sign-in identifier (email) for this pool.
    const password = (body as Record<string, unknown>)?.["password"];
    if (typeof password !== "string" || !password) {
      return c.json({ error: "password is required" }, 400);
    }

    try {
      await cognitoClient.send(
        new InitiateAuthCommand({
          AuthFlow: "USER_PASSWORD_AUTH",
          ClientId: clientId,
          AuthParameters: { USERNAME: cognitoUsername, PASSWORD: password },
        }),
      );
    } catch (err) {
      if (err instanceof NotAuthorizedException) {
        return c.json({ error: "Incorrect password" }, 403);
      }
      if (err instanceof LimitExceededException) {
        return c.json({ error: "Too many attempts. Please wait before trying again." }, 429);
      }
      console.error("Password verification error:", err);
      return c.json({ error: "Failed to verify password" }, 500);
    }
  }

  // Delete Cognito user first — if this fails the client can retry safely.
  // UserNotFoundException means a prior attempt already succeeded; treat as success.
  try {
    await cognitoClient.send(
      new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: cognitoUsername }),
    );
  } catch (err) {
    if (!(err instanceof UserNotFoundException)) {
      console.error("Cognito deletion error:", err);
      return c.json({ error: "Failed to delete account" }, 500);
    }
  }

  // Cognito account is gone — clean up DynamoDB best-effort
  try {
    await deleteAllUserData(userId);
  } catch (err) {
    console.error("DynamoDB cleanup error after account deletion:", err);
    // Non-fatal: Cognito account is deleted; shelf data is inaccessible and will age out
  }

  return c.body(null, 204);
});
