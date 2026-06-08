# Skill: Generate Email Template

## Trigger

User requests creating, generating, or drafting outreach email content.

## Inputs

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `userProfile.name` | string | yes | non-empty |
| `userProfile.headline` | string | no | — |
| `userProfile.skills` | string[] | yes | ≥1 item |
| `userProfile.experience` | ExperienceItem[] | no | — |
| `recipient.name` | string | yes | non-empty |
| `recipient.title` | string | yes | non-empty |
| `recipient.company` | string | yes | non-empty |
| `customPrompt` | string | no | ≤500 characters |

## Steps

1. **Validate recipient context** — confirm `recipient.name`, `recipient.title`, and `recipient.company` are non-empty strings. If any are missing, STOP and report which required fields are absent.
2. **Build prompt** — construct the LLM prompt combining:
   - User profile: name, headline, skills list, experience summary
   - Recipient context: name, title, company
   - Custom prompt (if provided and ≤500 chars, else ignore)
   - Instruction: output plain-text subject + body with `{{name}}`, `{{company}}`, `{{title}}` placeholders
3. **Call Ollama** — POST to `/api/generate` (connection pattern from `backend/src/file-upload/ollama.helper.ts`):
   ```
   { model: <env-configured>, prompt: <built>, stream: false }
   ```
   Timeout: 30 seconds.
4. **Retry on timeout** — if Ollama fails or times out, wait 5 seconds, retry once. If retry also fails, STOP and report: "Ollama service unavailable. Please provide a manual template."
5. **Validate output** — parse the response into `subject` and `body`:
   - Subject: non-empty, ≤200 characters, no HTML tags
   - Body: non-empty, ≤2000 characters, no HTML tags
6. **Retry on invalid output** — if validation fails, retry generation once with a simplified prompt (remove `customPrompt`). If still invalid, STOP and report: "Generated content did not meet format constraints. Please provide a manual template."
7. **Return result** — output the validated `{ subject, body }` with placeholder tokens preserved.

## Output

```json
{
  "subject": "string (≤200 chars, plain text, may contain {{name}}/{{company}}/{{title}})",
  "body": "string (≤2000 chars, plain text, may contain {{name}}/{{company}}/{{title}})"
}
```

## Error Handling

| Condition | Action |
|-----------|--------|
| Missing recipient field (name, title, or company) | STOP, report which fields are missing |
| Ollama timeout (>30s) | Retry once after 5s delay |
| Two consecutive Ollama failures | STOP, suggest manual template |
| Output has HTML or exceeds length | Retry with simplified prompt (no customPrompt) |
| Two consecutive validation failures | STOP, suggest manual template |

## Placeholders

Generated templates MUST preserve these literal tokens for later substitution:
- `{{name}}` — recipient's name
- `{{company}}` — recipient's company
- `{{title}}` — recipient's job title

## Reference

- Connection pattern: `backend/src/file-upload/ollama.helper.ts`
- Model: use environment-configured model (same as resume parsing)
- Endpoint: Ollama native `/api/generate` with `stream: false`
