# /dev — Start the dev stack

Start the API and web dev servers. Handles AWS credential acquisition via
Granted Assume automatically.

## AWS profile

```
Sandbox/AWSPowerUserAccess
```

## Steps

1. **Check for active credentials** by running:

   ```bash
   aws sts get-caller-identity
   ```

   - If this succeeds, credentials are valid — proceed to step 3.
   - If this fails, proceed to step 2.

2. **Acquire credentials** using Granted Assume with `--exec` so the API server
   process inherits the credentials without requiring shell integration:

   ```bash
   assume Sandbox/AWSPowerUserAccess --exec "pnpm --filter @bookshelf/api dev"
   ```

   This starts the API server with credentials injected. Skip step 3 for the API
   since it is already running inside the `assume --exec` subprocess.

3. **Start the web dev server** (does not require AWS credentials):
   ```bash
   pnpm --filter @bookshelf/web dev
   ```

## Notes

- API runs on `:3001`, web on `:3000`.
- If credentials are already valid, both servers start directly without invoking `assume`.
- If `assume` opens a browser for SSO, complete the login and the API server will
  start automatically once authentication succeeds.
- To restart after credential expiry, stop the API server and re-run `/dev` —
  it will re-acquire credentials via `assume --exec` again.
