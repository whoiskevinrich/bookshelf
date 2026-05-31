# Spec: Authentication

**Status:** Draft  
**Date:** 2026-05-31  
**Author:** Solo developer

---

## Problem Statement

The API's authenticated routes (`/v1/shelf`, `POST /v1/shelf`, etc.) are fully implemented and protected by Cognito JWT middleware, but there is no web UI to sign up, sign in, or sign out. This makes it impossible to perform end-to-end testing — a developer cannot obtain a valid JWT without using the AWS CLI or Cognito hosted UI directly. This spec covers the authentication layer of `apps/web`: the sign-up, sign-in, and sign-out flows, email verification, password reset, and the session management plumbing that makes all other authenticated pages possible.

---

## Goals

1. A developer can sign up, verify their email, sign in, and make authenticated API calls entirely through the web UI — no AWS Console or CLI required.
2. Auth tokens (ID token, access token, refresh token) are managed by Amplify Auth; the app never stores raw JWTs in `localStorage` directly.
3. All authenticated routes in the SPA redirect unauthenticated users to `/auth/login` and restore the intended destination after sign-in.
4. The sign-up and sign-in forms report Cognito errors clearly (wrong password, unverified email, user not found) without exposing internal details.
5. A signed-in session survives a page refresh (token refresh via Cognito refresh token).

---

## Non-Goals

- **Social / federated login** (Google, GitHub, SAML): Cognito supports this but it requires a Hosted UI or separate federation config — deferred; the UserPool App Client will have no Identity Providers attached in v1.
- **MFA / TOTP**: Out of scope; Cognito supports it but adds UX complexity not needed for a hobby project.
- **Admin user management**: No admin UI for listing or disabling accounts; all user management is self-service.
- **Account deletion**: Users cannot delete their own account in v1; deferred until data deletion implications are understood.
- **Email customization**: Cognito's default verification and confirmation emails are acceptable for v1; custom email templates are deferred.

---

## User Stories

### New visitor

- As a visitor, I want to create an account with my email and a password so that I can start building my shelf.
- As a visitor, I want to verify my email address after sign-up so that my account is confirmed and I can sign in.
- As a visitor who entered the wrong verification code, I want to request a new code so that I am not locked out.

### Returning user

- As a registered user, I want to sign in with my email and password so that I can access my shelf.
- As a returning user, I want my session to persist after a page refresh so that I do not have to sign in repeatedly.
- As a user on a shared device, I want to sign out so that my shelf is not accessible to others.

### Forgot password

- As a user who forgot their password, I want to request a password reset email so that I can regain access.
- As a user clicking the reset link, I want to enter a new password and have it take effect immediately so that I can sign in without contacting support.

### Protected routes

- As an unauthenticated user who navigates to `/shelf`, I want to be redirected to `/auth/login` so that I know I need to sign in.
- As a user who was redirected to login from a protected route, I want to be sent back to that route after signing in so that I do not lose my place.

---

## Requirements

### Must-Have (P0)

**Sign-up flow**

- [ ] `/auth/signup` renders a form with: email, password, confirm-password fields, and a submit button.
- [ ] Password must meet Cognito User Pool requirements: minimum 8 characters, at least one uppercase letter, one lowercase letter, and one number. No special character required. The form shows these requirements and validates client-side before submitting.
- [ ] On submit, `signUp()` is called via Amplify Auth. On success, the user is redirected to `/auth/verify` with their email passed as state.
- [ ] If the email is already registered, the form shows: "An account with this email already exists."
- [ ] All Cognito error messages are mapped to user-friendly strings; raw Cognito error codes (`UsernameExistsException`, etc.) are never shown.

**Email verification**

- [ ] `/auth/verify` renders a form with a 6-digit code field and a submit button.
- [ ] On success, the user is redirected to `/auth/login` with a confirmation banner: "Email verified. You can now sign in."
- [ ] If the code is wrong or expired, the form shows: "Incorrect or expired code. Try again or request a new one."
- [ ] A "Resend code" link calls `resendSignUpCode()` and shows inline feedback ("New code sent to your email.").

**Sign-in flow**

- [ ] `/auth/login` renders a form with: email, password fields, submit button, and a "Forgot password?" link.
- [ ] On success, the session is stored via Amplify Auth (tokens managed internally). The user is redirected to the `next` query-string parameter if present, otherwise to `/shelf`.
- [ ] If credentials are wrong, the form shows: "Incorrect email or password."
- [ ] If the account exists but the email is not yet verified, the form shows: "Please verify your email before signing in." with a link to `/auth/verify`.
- [ ] All Cognito error codes are mapped to user-friendly strings.

**Session management**

- [ ] `lib/auth.ts` wraps Amplify Auth and exposes: `signUp()`, `confirmSignUp()`, `resendCode()`, `signIn()`, `signOut()`, `getSession()`, `getCurrentUser()`.
- [ ] `lib/auth.ts` reads Cognito config (User Pool ID, App Client ID, region) from environment variables (`VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`, `VITE_COGNITO_REGION`), not hardcoded values.
- [ ] `getCurrentUser()` returns the authenticated user's ID token; the token is passed as `Authorization: Bearer <id_token>` to all API calls.
- [ ] A React context (`AuthContext`) wraps the app and exposes current user state; all components read auth state from this context, not from Amplify directly.
- [ ] On page load, `AuthContext` restores the session from the Amplify token store (survives refresh).
- [ ] Expired access tokens are silently refreshed using the Cognito refresh token; the user is only redirected to login if the refresh fails.

**Route protection**

- [ ] A `ProtectedRoute` component wraps all routes under `/shelf`, `/wishlist`, and `/search`. It renders a loading indicator while the session is being restored, then redirects unauthenticated users to `/auth/login?next=<current-path>`.
- [ ] Auth routes (`/auth/login`, `/auth/signup`, `/auth/verify`, `/auth/forgot-password`, `/auth/reset-password`) redirect already-authenticated users to `/shelf`.

**Sign-out**

- [ ] A "Sign out" button in the app header calls `signOut()` and redirects to `/`.
- [ ] After sign-out, the session is cleared from the Amplify store; refreshing the page does not restore the session.

**Forgot password / reset**

- [ ] `/auth/forgot-password` renders an email field and submit. Calls `resetPassword()` via Amplify. On success, redirects to `/auth/reset-password` with the email as state.
- [ ] `/auth/reset-password` renders: code field, new password, confirm password fields. Calls `confirmResetPassword()`. On success, redirects to `/auth/login` with banner: "Password updated. Please sign in."
- [ ] Invalid or expired reset codes show: "Incorrect or expired code. Request a new one."

---

### Nice-to-Have (P1)

- [ ] Show/hide password toggle on password fields.
- [ ] Form fields are auto-focused on mount (email on login/signup, code on verify).
- [ ] Sign-in form remembers the last-used email (localStorage) as a convenience.
- [ ] Loading spinner on submit buttons during async Cognito calls to prevent double-submit.

---

### Future Considerations (P2)

- Federated login (Google OAuth via Cognito Identity Provider).
- TOTP-based MFA.
- Self-service account deletion (must also delete DynamoDB data for the user).
- Custom Cognito email templates (branded verification and reset emails).
- **SES as Cognito email sender** — replace the default `no-reply@verificationemail.com` sender with a verified SES identity to improve deliverability and eliminate spam-folder issues. Cost: ~$0 at hobby scale ($0.10/1,000 emails). Requires: verified SES sending domain, SES production access request (if account is still sandboxed), and a one-line change to `AuthStack`. See `docs/runbooks/auth-troubleshooting.md#ses-upgrade-path`.

---

## Acceptance Criteria (end-to-end test path)

This is the flow that must work to unblock E2E testing of the shelf feature:

```
1. Navigate to /auth/signup
2. Enter a valid email + strong password → submit
3. Receive Cognito verification email; enter code at /auth/verify → submit
4. Redirected to /auth/login with "Email verified" banner
5. Enter credentials → submit
6. Redirected to /shelf (authenticated)
7. Make a shelf API call — Authorization header contains a valid Cognito ID token
8. Navigate to / and click "Sign out"
9. Navigate to /shelf → redirected to /auth/login
```

---

## Technical Notes

**Amplify Auth v6 configuration**

Amplify v6 uses `Amplify.configure()` with an `Auth` resource object. The config is constructed from `VITE_*` env vars at app startup. No `aws-exports.js` file — config is explicit and type-safe.

```ts
// apps/web/src/main.tsx
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
      userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
    },
  },
});
```

**Token to API call**

Amplify stores the ID token in its internal store. `fetchAuthSession()` returns the current session; `session.tokens.idToken.toString()` is the bearer token for API calls. The API's `authMiddleware` validates this as a Cognito JWT.

**Environment variables required**

| Variable                    | Source                 |
| --------------------------- | ---------------------- |
| `VITE_COGNITO_USER_POOL_ID` | `AuthStack` SSM output |
| `VITE_COGNITO_CLIENT_ID`    | `AuthStack` SSM output |
| `VITE_COGNITO_REGION`       | Deployment region      |
| `VITE_API_BASE_URL`         | `ApiStack` SSM output  |

---

## Open Questions

| #   | Question                                                                                           | Owner       | Blocking? | Resolution                                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------- | ----------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Should the Cognito App Client have `ALLOW_USER_SRP_AUTH` only, or also `ALLOW_REFRESH_TOKEN_AUTH`? | Engineering | Yes       | **Resolved** — `authFlows: { userSrp: true }` in CDK; refresh token validity is 30 days. Amplify v6 uses SRP + refresh automatically.                                           |
| 2   | Exact password policy in CDK — must match client-side validation.                                  | Engineering | Yes       | **Resolved** — min 8 chars, uppercase, lowercase, digits required; **symbols NOT required** (`requireSymbols: false`). Update spec requirement accordingly.                     |
| 3   | How `VITE_*` env vars get injected at deploy time.                                                 | Engineering | Yes       | **Resolved** — values are in SSM (`/bookshelf/cognito/user-pool-id`, `/bookshelf/cognito/client-id`). Deploy script reads SSM and writes `.env.production` before `vite build`. |

---

## Timeline Considerations

- This spec is the prerequisite for all other web UI features — nothing authenticated can be tested without it.
- No hard external deadline; ship when the acceptance criteria path above passes end-to-end.
- Phase 4 backlog items for auth pages can be marked as covered by this spec and moved to Active once implementation starts.
