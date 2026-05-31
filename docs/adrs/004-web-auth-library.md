# ADR-004: Web Authentication Library

**Status:** Accepted  
**Date:** 2026-05-31  
**Deciders:** Solo developer

---

## Context

The web app needs a client-side library to handle Cognito authentication flows: sign-up, email verification, sign-in, sign-out, password reset, and session management (token storage, silent refresh, session restore on page reload). The Cognito User Pool and App Client are already provisioned by `AuthStack` (SRP auth flow, no client secret, 30-day refresh tokens).

The primary goal was to unblock end-to-end testing of authenticated API routes — a developer must be able to obtain a valid Cognito JWT entirely through the web UI, without the AWS Console or CLI.

---

## Options Considered

### Option 1: `@aws-amplify/auth` (chosen)

AWS Amplify's auth-only package. Can be installed in isolation from the broader Amplify ecosystem.

**Pros:**

- Handles SRP auth, token storage, silent refresh, and session restore out of the box
- Well-typed TypeScript API in v6; install footprint limited to the auth slice
- Least implementation work — no hand-rolled SRP or refresh wiring

**Cons:**

- Largest bundle (~150–200 KB minified+gzipped)
- Tokens stored in `localStorage` by default
- Abstraction layer over Cognito means error types come wrapped; Cognito error codes still accessible via `.name`
- Config format changed significantly between v5 and v6; outdated docs cause confusion

### Option 2: `amazon-cognito-identity-js`

The lower-level SDK that Amplify Auth wraps internally.

**Pros:**

- Smaller bundle (~60 KB)
- Direct Cognito SRP calls; errors surface as raw Cognito codes
- More control over token storage and refresh

**Cons:**

- Callback-based API requires Promise wrappers throughout
- More boilerplate; refresh and session restore must be hand-implemented
- Still a meaningful dependency for what ultimately amounts to a few authenticated fetches

### Option 3: `oidc-client-ts` (generic OIDC/OAuth2)

A standards-based OIDC client. Cognito exposes a compliant OIDC endpoint.

**Pros:**

- Provider-agnostic; swapping Cognito for Auth0/Clerk requires only config changes
- Handles PKCE, token refresh, and storage correctly; ~80 KB

**Cons:**

- SRP password auth (username/password form without a redirect) is not part of OIDC — requires Cognito Hosted UI for sign-in, or falls back to `amazon-cognito-identity-js` for the password flow
- Hosting the Hosted UI requires a Cognito custom domain (~$0.40/month, additional CDK config)
- Breaks the "own your auth forms" requirement from the spec

### Option 4: Cognito Hosted UI (redirect flow, no client library)

Redirect users to Cognito's managed login page; exchange the auth code for tokens via PKCE.

**Pros:**

- Zero client-side auth library; token exchange is a few `fetch` calls
- MFA, social login, email verification handled entirely by Cognito

**Cons:**

- Does not own the login UI — Cognito's hosted page has limited CSS customization
- Requires a Cognito custom domain on the User Pool (additional CDK config, ~$0.40/month)
- Not compatible with the spec requirement for custom auth pages

---

## Cost Analysis

All four options have **identical Cognito costs** — the library choice has no effect on AWS billing. Cognito charges $0.0055/MAU beyond the permanent 10,000 MAU free tier regardless of which SDK makes the calls.

The only cost difference: Option 3 and Option 4 require a **Cognito custom domain**, which adds ~$0.40/month. Options 1 and 2 do not.

---

## Decision

**`@aws-amplify/auth` (Option 1).**

The deciding factors:

1. **Goal is E2E test coverage, not production polish.** The primary deliverable is a working auth flow that unblocks shelf feature testing. Minimizing implementation time is the correct tradeoff at this stage.

2. **Abstraction is contained.** All Amplify calls are isolated behind `lib/auth.ts`. The rest of the app — `AuthContext`, `ProtectedRoute`, auth pages — imports only from `lib/auth.ts`, never from Amplify directly. Swapping the library later means rewriting one ~100-line file.

3. **It's a 2-way door.** The only migration friction is token storage format: Amplify uses its own `localStorage` key scheme, so a library swap silently invalidates existing sessions. For a hobby project with a small number of test accounts this is acceptable — users re-login once.

4. **Bundle size is acceptable.** 380 KB minified (114 KB gzipped) for the full JS bundle including Amplify, React, and React Router is within normal bounds for an auth-gated SPA.

---

## Consequences

**Easier:**

- SRP auth, token refresh, and session restore require no hand-implementation
- Amplify v6 `fetchAuthSession()` returns the ID token directly; passed as `Authorization: Bearer` to the API

**Harder:**

- Cognito error codes are wrapped by Amplify; accessing the raw code requires `(err as { name?: string }).name`
- If Amplify v6 → v7 introduces another config-format break, `lib/auth.ts` will need updating
- Token storage format is Amplify-specific; a future library swap invalidates stored sessions

**To revisit:**

- If bundle size becomes a concern, replace with `amazon-cognito-identity-js` — the `lib/auth.ts` interface stays identical
- If a second auth provider is ever needed, `oidc-client-ts` with the Hosted UI becomes the better fit
