# Validation Rules

Evaluate sequentially before each skill invocation. On failure: stop operation, report rule number, failing value, and corrective action.

## 1. Email Validation

- [ ] Format matches `local@domain.tld`
- [ ] Local part: 1–64 characters, no whitespace
- [ ] Domain part: 1–253 characters, contains ≥1 dot, no whitespace
- [ ] Entire string contains no whitespace characters

**On failure:** Rule 1 — value: `{email}` — action: provide a valid email in format `user@example.com`

## 2. PDF Validation

- [ ] File extension ends in `.pdf` (case-insensitive)
- [ ] File size ≤ 10 MB (10,485,760 bytes)

**On failure:** Rule 2 — value: `{filename}, {size}` — action: provide a `.pdf` file under 10 MB

## 3. Deduplication

- [ ] Before creating a user record, query by `email.toLowerCase().trim()`
- [ ] If existing record found → update profile fields on that record
- [ ] Never create a duplicate entry for the same email

**On failure:** Rule 3 — value: `{email}` — action: update the existing record instead of inserting

## 4. Required Fields Per Skill

### 4a. PDF Extraction (`extract-pdf-data`)
- [ ] `userId` — non-empty string in MongoDB ObjectId format (24 hex chars)

### 4b. Database Storage (`store-candidates-db`)
- [ ] `name` — non-empty string
- [ ] `email` — non-empty string passing Rule 1

### 4c. Email Send (`send-email`)
- [ ] `mailIds` — array with ≥1 entry passing Rule 1
- [ ] `subject` — non-empty string
- [ ] `context` — non-empty string

### 4d. Template Generation (`generate-email-template`)
- [ ] `name` — non-empty string
- [ ] `skills` — array with ≥1 non-empty entry

### 4e. Recipient Context (for template generation)
- [ ] `recipient.name` — non-empty string
- [ ] `recipient.title` — non-empty string
- [ ] `recipient.company` — non-empty string

**On failure:** Rule 4 — value: `{field}=missing|empty` — action: supply the required field with a non-empty value matching its constraints

## 5. Failure Reporting Format

Every validation failure report MUST include exactly:
1. **Rule number** — which rule was violated (e.g., Rule 1, Rule 4b)
2. **Failing value** — the input that caused the failure
3. **Corrective action** — what valid input looks like
