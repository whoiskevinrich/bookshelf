# Runbook: Auth Troubleshooting

## Verification email not received

**Symptom:** User completes sign-up but never receives the 6-digit verification code.

**Most likely cause:** Cognito's default email sender (`no-reply@verificationemail.com`) is flagged as spam.

**Resolution:**

1. Check spam/junk folder for an email from `no-reply@verificationemail.com`
2. Mark as "not spam" and whitelist the sender if found

**Why this happens:** By default, Cognito uses its own shared email service with a generic sender address. It has no SPF/DKIM alignment with any custom domain, so spam filters frequently catch it. The daily send limit is also capped at 50 emails.

**Long-term fix:** Configure SES as the Cognito email sender (see [ADR-004 open item](#ses-upgrade-path) and the SES cost note below). This gives Cognito a verified sender address with proper DKIM, dramatically improving deliverability.

---

## Sign-up succeeds but sign-in fails with "Incorrect email or password"

**Symptom:** User created an account but cannot sign in.

**Cause:** The account exists but email is not yet verified. Cognito blocks sign-in for unconfirmed accounts.

**Resolution:** Navigate to `/auth/verify`, enter the email address, and submit the verification code. Use "Resend code" if the original code expired.

**Verification in AWS Console:** Go to **Cognito → User Pools → bookshelf-users → Users**. Unconfirmed users show status `Unconfirmed`. Confirmed users show `Confirmed`.

---

## Verification code expired

**Symptom:** Entering a code returns "Incorrect or expired code."

**Cause:** Cognito verification codes expire after **24 hours**.

**Resolution:** Click "Resend code" on the `/auth/verify` page. A fresh code is sent immediately.

---

## "An account with this email already exists" on sign-up

**Symptom:** Sign-up form shows this error for an email the user believes is new.

**Cause:** A previous sign-up attempt created an unconfirmed account. Cognito counts it as existing even if never verified.

**Resolution:** Go to `/auth/verify` and verify the existing account, or use the AWS Console to delete the unconfirmed user and retry:

```bash
aws cognito-idp admin-delete-user \
  --user-pool-id <USER_POOL_ID> \
  --username <email> \
  --region us-west-2
```

---

## Token silently expired — user redirected to login unexpectedly

**Symptom:** User is redirected to `/auth/login` mid-session without signing out.

**Cause:** The Cognito refresh token expired (30-day validity). Amplify Auth attempts a silent refresh on page load; if the refresh token is expired, it clears the session and the `ProtectedRoute` redirects to login.

**Resolution:** This is expected behaviour after 30 days of inactivity. The user signs in again and receives a fresh token set.

---

## SES upgrade path

Cognito's default email sender is acceptable for development but has known deliverability issues in production. To improve deliverability:

1. Verify a sending domain or address in SES (AWS Console → SES → Verified identities)
2. If your AWS account is in the **SES sandbox**, request production access first (SES → Account dashboard → Request production access)
3. Update `AuthStack` to use SES:

```ts
email: cognito.UserPoolEmail.withSES({
  sesRegion: "us-west-2",
  fromEmail: "noreply@yourdomain.com",
  fromName: "Bookshelf",
}),
```

4. `cdk deploy BookshelfAuthStack`

See cost implications in `docs/adrs/004-web-auth-library.md` or ask about SES pricing before enabling.
