# Spec: Invitation-Only Sign-Up for Dev Environment

**Status**: Draft  
**Date**: 2026-06-01

---

## Problem Statement

The dev Cognito User Pool has `selfSignUpEnabled: true`, meaning anyone who discovers the dev app URL can create an account and interact with dev infrastructure. This exposes DynamoDB tables and Lambda functions to uncontrolled, unintended traffic. Since dev is a personal sandbox—not a product environment—there is no legitimate reason for self-registration to be open.

---

## Goals

1. Prevent any user from creating a dev account without an explicit invitation from the admin.
2. Keep production behavior unchanged—self-sign-up remains available there.
3. Leave the sign-in flow identical for invited users (email + password, same Amplify Auth integration).
4. Allow the admin to invite new dev testers via a single AWS CLI command or the AWS Console.

---

## Non-Goals

- **No prod change**: Production auth is out of scope for this spec. Self-signup stays on in prod.
- **No invite UI**: A web-based invite flow (admin dashboard, invite links) is not built here. AWS Console / CLI is sufficient for a solo-dev context.
- **No email domain restriction**: Allowlisting specific email domains is a separate concern.
- **No MFA enforcement**: Out of scope; tracked separately.
- **No custom email templates**: Cognito's default invite email is acceptable for now.

---

## User Stories

**As the app owner (admin), I want** dev sign-up to be blocked for anonymous visitors **so that** no one can use dev infrastructure without my knowledge.

**As the app owner (admin), I want** to invite a specific tester by email **so that** they can access the dev environment without me giving them my credentials.

**As an invited tester, I want** to receive an email with a temporary password **so that** I can log in and test the app without needing a separate account-creation flow.

**As an invited tester, I want** to be prompted to set a permanent password on first login **so that** I control my own credentials going forward.

---

## Requirements

### Must-Have (P0)

- **Disable self-sign-up in dev**: `selfSignUpEnabled: false` on the dev User Pool. Attempting to register via the SPA or Cognito API returns an error.
  - _Acceptance_: A new browser session visiting `/register` (or equivalent) cannot create an account; Cognito rejects the `signUp` API call.
- **Environment-aware CDK**: The `AuthStack` reads a prop (e.g. `allowSelfSignUp: boolean`) that is `false` for dev and `true` for prod.
  - _Acceptance_: `cdk synth` for dev outputs `selfSignUpEnabled: false`; for prod it outputs `true`.
- **Admin invite path documented**: A runbook entry explains how to invite a user via `aws cognito-idp admin-create-user`.
  - _Acceptance_: Runbook exists at `docs/runbooks/invite-dev-user.md`.

### Nice-to-Have (P1)

- **Graceful UI message**: If a visitor somehow reaches the sign-up form (e.g. a stale link), they see a clear message ("Sign-up is not available in this environment") rather than a raw API error.

### Future Considerations (P2)

- A lightweight admin invite page in the web app.
- Allowlisting trusted email domains alongside invitation gating.

---

## Success Metrics

| Metric                                    | Target                  |
| ----------------------------------------- | ----------------------- |
| Unauthorized self-signup attempts succeed | 0 after deploy          |
| Admin can invite a user end-to-end        | ≤ 5 min via CLI         |
| Prod self-signup regression               | None (smoke tests pass) |

---

## Open Questions

| #   | Question                                                                                                                                                                                       | Owner | Blocking? |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------- |
| 1   | ~~Should the SPA hide the "Create account" UI in dev, or just let Cognito reject it?~~ **Resolved:** Let Cognito reject it — the form stays visible, the error message explains the situation. | —     | Closed    |

---

## Timeline Considerations

- No hard deadline; improvement is purely defensive.
- CDK change is a one-line prop + stack wiring — low-risk, deploy with the next available change.
- Must redeploy `AuthStack` (dev only); no data migration needed — existing dev accounts are preserved.
