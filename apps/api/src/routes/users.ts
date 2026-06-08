import { Hono } from "hono";
import {
  CognitoIdentityProviderClient,
  AdminDeleteUserCommand,
  UserNotFoundException,
} from "@aws-sdk/client-cognito-identity-provider";
import { authMiddleware } from "../middleware/auth.js";
import { deleteAllUserData } from "../lib/dynamo.js";

const cognitoClient = new CognitoIdentityProviderClient({});
// Read at module scope — same pattern as TABLE_NAME in dynamo.ts.
// A missing pool ID is a deploy-time misconfiguration, not a per-request condition.
const userPoolId = process.env["COGNITO_USER_POOL_ID"];

export const usersRouter = new Hono();

usersRouter.use("*", authMiddleware);

// DELETE /v1/users/me — purge all shelf data and delete the Cognito account
usersRouter.delete("/me", async (c) => {
  const { userId, cognitoUsername } = c.get("auth");

  if (!userPoolId) {
    return c.json({ error: "Server misconfiguration" }, 500);
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
