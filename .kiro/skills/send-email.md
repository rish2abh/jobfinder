# Skill: Send Email

## Trigger

User requests sending emails, outreach messages, or bulk mail to one or more recipients.

## Inputs

| Parameter | Type | Constraints | Required |
|-----------|------|-------------|----------|
| `mailIds` | string[] | RFC 5322 emails, max 50 entries | Yes |
| `subject` | string | Non-empty | Yes |
| `context` | string | Non-empty (email body text) | Yes |
| `userId` | string | MongoDB ObjectId (24 hex chars) | One of `userId` or `resumeFile` required |
| `resumeFile` | PDF buffer | `.pdf` extension, ≤15 MB | One of `userId` or `resumeFile` required |

## Steps

1. **Validate recipient emails**
   - Apply `@IsEmail()` (class-validator, RFC 5322) to each entry in `mailIds`.
   - Partition into `validEmails` and `invalidEmails`.
   - Report each invalid entry to the user with the reason for rejection.
   - If `validEmails` is empty → HALT. Do not enqueue a job.
   - If `validEmails.length > 50` → HALT. Inform user of the 50-recipient cap.

2. **Validate attachment source**
   - Confirm at least one of `userId` or `resumeFile` is provided.
   - If neither is present → HALT. Inform the user one is required for the resume attachment.

3. **Enqueue bulk mail job**
   - Build a `SendBulkMailDto` with `{ mailIds: validEmails, subject, context, userId }`.
   - Call `MailService.enqueueBulkMail(dto, resumeFile?)` in `backend/src/mail/mail.service.ts`.
   - Capture the returned `{ jobId, status: 'queued' }`.

4. **Return job reference**
   - Return `{ jobId }` to the user.
   - Inform them to poll status via `MailService.getJobStatus(jobId)` which returns `state`, `progress`, `result` (with `sentCount` / `failedCount`), and `failedReason`.

## Output

```json
{ "jobId": "string" }
```

Poll `getJobStatus(jobId)` for: `state`, `sentCount`, `failedCount`, `failedReason`.

## Error Handling

| Condition | Action |
|-----------|--------|
| All emails invalid | HALT — report each invalid email and reason |
| Exceeds 50 recipients | HALT — inform user of the per-invocation cap |
| Missing `userId` and `resumeFile` | HALT — inform user one is required |
| BullMQ enqueue failure | Report error message to the user |
| Job fails during processing | Retried by queue (3 attempts, exponential backoff from 5 s) — poll `getJobStatus` for `failedReason` |

## Constraints

- **Max recipients:** 50 per invocation
- **Retry policy:** 3 attempts, exponential backoff starting at 5 seconds (5 s → 10 s → 20 s)
- **Queue config:** `bull-redis.config.ts` provides Redis connection to BullMQ

## Referenced Modules

- `backend/src/mail/mail.service.ts` — `enqueueBulkMail()`, `getJobStatus()`
- `backend/src/mail/mail.processor.ts` — BullMQ worker (SMTP send with pooling)
- `backend/src/mail/bull-redis.config.ts` — Redis connection builder for BullMQ
