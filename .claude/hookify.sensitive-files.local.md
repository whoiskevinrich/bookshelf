---
name: warn-sensitive-files
enabled: true
event: file
action: warn
conditions:
  - field: file_path
    operator: regex_match
    pattern: (\.env|secrets|credentials)
---

**SECURITY: Editing a sensitive file.**

For bookshelf, book API keys (Open Library, Google Books, etc.) must be in environment variables only — never hardcoded in source.

- Use `process.env.VARIABLE_NAME` in code
- Add `.env*` to `.gitignore`
- Never commit credentials to the repository
