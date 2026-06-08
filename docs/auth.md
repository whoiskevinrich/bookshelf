# Authentication & Account Management Flows

Reference for how Bookshelf handles auth, account operations, and the security contracts that govern them.

## Token model

Bookshelf uses **Cognito ID tokens** (not access tokens) for API authorization.

| Property    | Value                                                                               |
| ----------- | ----------------------------------------------------------------------------------- |
| Token type  | `id` (`token_use: "id"` enforced in `authMiddleware`)                               |
| Issued by   | Cognito User Pool (us-west-2)                                                       |
| Client      | Amplify v6 (`@aws-amplify/auth`) — obtained via `fetchAuthSession().tokens.idToken` |
| Expiry      | 1 hour (Cognito pool default)                                                       |
| Claims used | `sub` (userId), `cognito:username` (email — used for admin API calls)               |

The API middleware (`apps/api/src/middleware/auth.ts`) validates every request:

1. Bearer token present
2. Signature valid against Cognito JWKS
3. `token_use === "id"` — access tokens are rejected
4. `sub` present — used as the DynamoDB partition key user ID
5. `cognito:username` present — required for `AdminDeleteUser` calls

---

## Auth flows

### Sign up

```
User → SignUpPage
  → amplifySignUp({ username: email, password })
  → Cognito sends verification email (HTML template via CustomMessage Lambda)
  → VerifyPage: amplifyConfirmSignUp({ username, confirmationCode })
  → Redirect to /shelf
```

Sign-up is gated: Cognito pool is in `ALLOW_USER_SRP_AUTH` mode. If `NotAuthorizedException` is returned from `signUp`, the user sees "Sign-up is not available in this environment. Contact the app owner."

### Sign in

```
User → LoginPage
  → amplifySignIn({ username: email, password }) via SRP
  → On success: AuthContext polls getCurrentUser() → sets user state
  → Redirect to /shelf (or original destination via React Router state)
```

Password reset is initiated from LoginPage ("Forgot password?" link) → `resetPassword(email)` → user receives email with code (HTML template) → `ConfirmResetPasswordPage` calls `confirmResetPassword(email, code, newPassword)`.

### Change password (authenticated)

```
User → /account/settings → /account/change-password
  → ChangePasswordPage: amplifyUpdatePassword({ oldPassword, newPassword })
  → Cognito validates current password server-side (no separate re-auth needed — Amplify manages the session)
  → On success: redirect to /account/settings after 1.5s
```

Errors: `NotAuthorizedException` → "Current password is incorrect." (distinct from the sign-in message). Password requirements validated client-side against `validatePassword()` before the API call.

### Account deletion

```
User → /account/settings → /account/delete
  → DeleteAccountPage: user types "DELETE" to enable submit
  → DELETE /v1/users/me (authenticated)
    → API: AdminDeleteUser(cognitoUsername) — idempotent; UserNotFoundException treated as success
    → API: deleteAllUserData(userId) — best-effort; DynamoDB scan+batch-delete, paginated
    → API: 204 No Content
  → Client: signOut() (may fail since Cognito account is gone — inner try/catch swallows)
  → Navigate to /auth/login with banner: "Your account has been permanently deleted."
```

**Ordering contract**: Cognito is deleted first. If the DynamoDB cleanup fails, the data is inaccessible (no valid credentials can authenticate as that sub) and will remain orphaned. This is a deliberate tradeoff: a failed Cognito deletion is retryable by the client; orphaned DynamoDB data is harmless.

---

## Cognito email templates

All Cognito-triggered emails are rendered by the `CustomMessage` Lambda trigger (`packages/infra/lambda/custom-message/index.js`). The trigger handles:

| `triggerSource`                 | Subject                            | Use case            |
| ------------------------------- | ---------------------------------- | ------------------- |
| `CustomMessage_SignUp`          | "Verify your Bookshelf account"    | New registration    |
| `CustomMessage_ResendCode`      | "Verify your Bookshelf account"    | Resend verification |
| `CustomMessage_ForgotPassword`  | "Reset your Bookshelf password"    | Password reset      |
| `CustomMessage_AdminCreateUser` | "You've been invited to Bookshelf" | Admin invite        |

Emails use **inline styles only** (no external CSS) for email client compatibility. The Bookshelf wordmark appears as a `font-weight: 700` heading. Verification/reset codes are displayed in a monospace bordered box.

---

## Security constraints

| Constraint                    | Location                             | Reason                                                                                                                             |
| ----------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `token_use === "id"` enforced | `authMiddleware`                     | Access tokens don't carry identity claims; accepting them would widen the token type surface                                       |
| `cognitoUsername` required    | `authMiddleware`                     | `AdminDeleteUser` requires the Cognito username (email), not the sub UUID                                                          |
| No mock auth                  | `CLAUDE.md`, `VITE_MOCK_API` removed | Auth always runs against the real dev Cognito pool                                                                                 |
| `signOut()` throws on error   | `apps/web/src/lib/auth.ts`           | Global swallow would hide unexpected Amplify failures; `DeleteAccountPage` handles the post-deletion case with a local `try/catch` |
| IAM scoped to this pool       | `ApiStack`                           | `cognito-idp:AdminDeleteUser` restricted to `arn:…:userpool/${userPoolId}`                                                         |

### Known limitation: no password re-authentication before delete

Account deletion currently requires only a valid unexpired ID token plus typing "DELETE". It does not require the user to re-enter their password. This means a stolen or session-leaked ID token (valid for up to 1 hour) could be used to delete the account. Mitigating factors: HTTPS transport, Amplify stores tokens in localStorage (requires local device access to steal), and the app is a low-value personal tracker. A future hardening option is to add a password field to the delete form and call `InitiateAuth` server-side before `AdminDeleteUser`.

---

## File map

| File                                                 | Role                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| `apps/web/src/lib/auth.ts`                           | Amplify wrappers: signUp, signIn, signOut, changePassword, getSession |
| `apps/web/src/lib/api-client.ts`                     | API calls: deleteAccount (DELETE /v1/users/me)                        |
| `apps/web/src/context/AuthContext.tsx`               | React context: user state, signOut that also clears React state       |
| `apps/web/src/pages/account/AccountSettingsPage.tsx` | Hub: shows email, links to change-password and delete                 |
| `apps/web/src/pages/account/ChangePasswordPage.tsx`  | Change password form                                                  |
| `apps/web/src/pages/account/DeleteAccountPage.tsx`   | Account deletion confirmation form                                    |
| `apps/api/src/middleware/auth.ts`                    | JWT validation; populates `AuthContext` (userId, cognitoUsername)     |
| `apps/api/src/routes/users.ts`                       | DELETE /v1/users/me handler                                           |
| `apps/api/src/lib/dynamo.ts`                         | `deleteAllUserData()` — paginated batch-delete by PK                  |
| `packages/infra/lambda/custom-message/index.js`      | Cognito CustomMessage trigger — HTML email templates                  |
| `packages/infra/lib/auth-stack.ts`                   | Cognito User Pool + CustomMessage Lambda trigger wiring               |
| `packages/infra/lib/api-stack.ts`                    | IAM: `cognito-idp:AdminDeleteUser` grant to API Lambda                |
