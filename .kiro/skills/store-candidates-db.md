# Skill: Store Candidates in Database

## Trigger

User intent involves saving, persisting, or storing candidate or resume data to the database.

## Inputs

JSON object:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | yes | Candidate full name |
| `email` | string | yes | Unique identifier, will be lowercased and trimmed |
| `phone` | string | no | |
| `location` | string | no | |
| `headline` | string | no | |
| `bio` | string | no | |
| `linkedin` | string | no | |
| `github` | string | no | |
| `website` | string | no | |
| `skills` | string[] | no | |
| `experience` | ExperienceItem[] | no | {company, title, startDate, endDate, description} |
| `education` | EducationItem[] | no | {institution, degree, field, startDate, endDate} |
| `certifications` | string[] | no | |
| `languages` | string[] | no | |
| `projects` | ProjectItem[] | no | {name, description, technologies} |

Interfaces defined in `backend/src/users/user.schema.ts` (`UserProfile`).

## Steps

1. **Validate required fields** — If `name` or `email` is missing or empty, STOP and return error listing absent fields.
2. **Normalize email** — `const normalizedEmail = email.toLowerCase().trim()`
3. **Check for existing record** — Call `usersRepository.findByEmail(normalizedEmail)` (see `backend/src/users/users.repository.ts`).
4. **If user exists** — Call `usersRepository.updateProfile(existingUser, profileFields)` where `profileFields` is all optional fields from input.
5. **If user is new** — Call `usersRepository.create({ name, email: normalizedEmail })`, then call `usersRepository.updateProfile(newUser, profileFields)`.
6. **Return** the stored MongoDB document including `_id`.

## Output

```json
{
  "_id": "MongoDB ObjectId",
  "name": "string",
  "email": "string",
  "profile": { /* UserProfile fields */ },
  "createdAt": "ISO 8601",
  "updatedAt": "ISO 8601"
}
```

## Error Handling

- **Missing required fields** — Return `{ error: "missing_fields", fields: ["name"|"email"] }`. Do not call repository.
- **Database connection failure** — Classify as transient, retry once after 5s per `failure.rules.md`.
- **Duplicate key race condition** — If `create` throws duplicate key error, fall back to `findByEmail` + `updateProfile`.
