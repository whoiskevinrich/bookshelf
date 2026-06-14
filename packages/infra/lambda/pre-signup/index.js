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

// An email can resolve to a native account plus one or more federated (Google_*) entries.
// Fetch enough rows to find the native account even when a federated entry sorts first.
const MAX_LINK_CANDIDATES = 10;

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
        Limit: MAX_LINK_CANDIDATES,
      }),
    );

    // Find the existing NATIVE (Cognito) account to link this Google identity to. Match on the
    // email attribute, NOT Username: an account created via AdminCreateUser in an email-alias pool
    // gets a UUID Username (email is only an alias), so a `Username === email` check misses it.
    // (This is the migration pre-provision case — ADR-015. A self-signup native user happens to
    // have email as Username, which also passes the checks below.) Exclude Google-federated
    // entries (Username `Google_*` or an `identities` attribute). Link to CONFIRMED accounts
    // (normal native signups) and FORCE_CHANGE_PASSWORD accounts (migration pre-provisioned) — but
    // never UNCONFIRMED self-signups, which have no password yet and must finish their own email
    // verification first.
    const linkableStatuses = new Set(["CONFIRMED", "FORCE_CHANGE_PASSWORD"]);
    const nativeUser = Users.find(
      (u) =>
        !u.Username.startsWith("Google_") &&
        !(u.Attributes ?? []).some((a) => a.Name === "identities" && a.Value) &&
        linkableStatuses.has(u.UserStatus),
    );

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
