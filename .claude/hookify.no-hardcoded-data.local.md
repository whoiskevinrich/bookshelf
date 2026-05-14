---
name: warn-no-hardcoded-data
enabled: true
event: file
action: warn
conditions:
  - field: new_text
    operator: regex_match
    pattern: (isbn|asin)\s*[:=]\s*["'][0-9A-Z]{10,13}["']
---

**Hardcoded book data detected.**

Book identifiers (ISBN/ASIN) must come from user input, external API lookups, or the database — not from source literals.

Exception: test fixtures are allowed. If this is test data, ignore this warning.

For production code, drive book data through:
1. User input forms (validated before use)
2. External API responses (Open Library, Google Books, etc.)
3. Database reads
