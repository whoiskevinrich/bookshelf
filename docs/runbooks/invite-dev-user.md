# Runbook: Invite a User to the Dev Environment

Self-signup is disabled on the dev Cognito User Pool. Use this runbook to grant a specific person access.

## Prerequisites

- AWS CLI configured with credentials for the dev account
- The target user's email address
- The User Pool ID (check SSM or CDK outputs):
  ```powershell
  aws ssm get-parameter --name /bookshelf/cognito/user-pool-id --query Parameter.Value --output text
  ```

## Steps

### 1. Create the user

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <USER_POOL_ID> \
  --username <EMAIL> \
  --user-attributes Name=email,Value=<EMAIL> Name=email_verified,Value=true \
  --desired-delivery-mediums EMAIL
```

Cognito sends the user a temporary password by email automatically.

### 2. (Optional) Force a specific temporary password

```bash
aws cognito-idp admin-set-user-password \
  --user-pool-id <USER_POOL_ID> \
  --username <EMAIL> \
  --password "Temp1234!" \
  --permanent false
```

### 3. User first login

The user logs in at `/auth/login` with their temporary password. Amplify's `signIn` returns a `CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED` challenge and redirects them through the password-change flow.

## Remove a user

```bash
aws cognito-idp admin-delete-user \
  --user-pool-id <USER_POOL_ID> \
  --username <EMAIL>
```

## Prod note

Self-signup is enabled in prod (`-c allowSelfSignUp=true` at deploy time), so this runbook applies to dev only.
