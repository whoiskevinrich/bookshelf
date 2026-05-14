---
name: warn-isbn-validation
enabled: true
event: file
action: warn
conditions:
  - field: new_text
    operator: contains
    pattern: isbn
---

**ISBN Validation Reminder**

Always validate ISBN before use — never trust raw user input.

- **ISBN-13**: 13 digits, Luhn-variant check digit validation required
- **ISBN-10**: 10 digits, last character may be `X` (value 10)
- Use a validation library rather than manual regex
- Reject malformed ISBNs at the API/form boundary before any lookup or storage
