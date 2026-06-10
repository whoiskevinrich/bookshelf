"use strict";

// PreSignUp trigger — runs before Cognito creates a new user account.
//
// Responsibilities:
//   1. Email allowlist check (when EMAIL_ALLOWLIST is set — dev only)
//   2. Auto-link Google sign-in to an existing native account with the same email,
//      preserving the user's sub and all their data.
//
// The AWS SDK v3 is bundled with Lambda Node.js 22.x; no node_modules needed.

const {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminLinkProviderForUserCommand,
} = require("@aws-sdk/client-cognito-identity-provider");

const client = new CognitoIdentityProviderClient({});

exports.handler = async (event) => {
  const { triggerSource, request, userName, userPoolId } = event;
  const email = (request.userAttributes.email ?? "").toLowerCase();

  // 1. Allowlist check — reject sign-ins from unlisted emails when configured
  const rawAllowlist = process.env.EMAIL_ALLOWLIST ?? "";
  if (rawAllowlist) {
    const allowlist = rawAllowlist.split(",").map((e) => e.trim().toLowerCase());
    if (!allowlist.includes(email)) {
      throw new Error("Access restricted.");
    }
  }

  // 2. Auto-link Google identity to existing native account (same email)
  //
  // When a user who registered with email/password first tries Google sign-in,
  // Cognito would create a new separate account. Instead, we link the Google
  // identity to the existing native account so the user keeps the same sub
  // and all their shelf data.
  if (triggerSource === "PreSignUp_ExternalProvider") {
    const { Users = [] } = await client.send(
      new ListUsersCommand({
        UserPoolId: userPoolId,
        Filter: `email = "${email}"`,
        Limit: 1,
      }),
    );

    // A native Cognito user created via Amplify signUp has email as their Username.
    // Only link to confirmed accounts — an unconfirmed account has no password set
    // and linking to it would leave the user unable to complete email verification.
    const nativeUser = Users.find((u) => u.Username === email && u.UserStatus === "CONFIRMED");

    if (nativeUser) {
      const googleUserId = userName.replace(/^Google_/, "");
      try {
        await client.send(
          new AdminLinkProviderForUserCommand({
            UserPoolId: userPoolId,
            DestinationUser: {
              ProviderName: "Cognito",
              ProviderAttributeValue: nativeUser.Username,
            },
            SourceUser: {
              ProviderName: "Google",
              ProviderAttributeName: "Cognito_Subject",
              ProviderAttributeValue: googleUserId,
            },
          }),
        );
      } catch (err) {
        if (err.name !== "AliasExistsException") throw err;
        // AliasExistsException: already linked — nothing to do
      }
    }

    event.response.autoConfirmUser = true;
    event.response.autoVerifyEmail = true;
  }

  return event;
};
