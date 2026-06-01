---
name: no-env-in-source
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: (launch\.json|\.env[^/]*|settings\.json|config\.json)$
  - field: new_text
    operator: regex_match
    pattern: (?i)(amazonaws\.com|cognito-idp|[a-z0-9]{20,}|[A-Za-z0-9+/]{30,}={0,2}|:[a-z]{2}-[a-z]+-[0-9]_[A-Za-z0-9]+|"[A-Za-z_]+":\s*"[^"]{8,}"(?!\s*\/\/))
---

**[NON-NEGOTIABLE] STOP — potential environment variable value detected in a tracked file.**

Environment variable values must NEVER be committed to source control — not in `launch.json`, `.env` files, config files, or anywhere else.

**What to do instead:**

- Store values in `apps/api/.env.local` or `apps/web/.env` (both gitignored)
- Load them at runtime: `tsx --env-file=.env.local` or Vite's automatic `.env` loading
- For `launch.json` specifically: remove the `"env"` block entirely and rely on the dev script to load the file

**If you already wrote the value:** stop, remove it, and treat it as potentially compromised if pushed.
