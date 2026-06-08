# Skill: Extract PDF Data

## Trigger

User requests parsing, extracting, or reading data from a PDF resume.

## Inputs

| Parameter | Type | Constraints | Required |
|-----------|------|-------------|----------|
| `file` | PDF buffer | `.pdf` extension, ≤15 MB | Yes |
| `userId` | string | MongoDB ObjectId (24 hex chars) | Yes |

## Steps

1. **Validate inputs**
   - Confirm `file` is present, has `.pdf` extension (case-insensitive), and size ≤ 15 MB.
   - Confirm `userId` is a valid MongoDB ObjectId (`/^[a-f0-9]{24}$/i`).
   - If either validation fails → HALT and report the specific invalid input. Do not call any backend service.

2. **Upload and enqueue parsing job**
   - Call `FileUploadService.uploadResume(file, userId)` in `backend/src/file-upload/file-upload.service.ts`.
   - This uploads the PDF to Cloudinary, extracts raw text via `pdf-parse`, and enqueues a BullMQ job on the `resume-parse` queue.
   - Capture the returned `{ jobId, status: 'queued', cloudinaryUrl }`.

3. **Poll job status**
   - Call `FileUploadService.getParseJobStatus(jobId)` in `backend/src/file-upload/file-upload.service.ts`.
   - Repeat every **3 seconds**, up to **30 attempts** maximum.
   - Stop polling when `state` is `"completed"` or `"failed"`.

4. **Return result**
   - If `state === "completed"`: return `result.parsedJson` to the user as structured JSON.
   - If `state === "failed"`: report the `failedReason` from the job status response.
   - If 30 polls elapse without completion: report timeout with `jobId` for manual follow-up.

## Output

Structured JSON object with these fields:

```json
{
  "name": "string | null",
  "email": "string | null",
  "phone": "string | null",
  "location": "string | null",
  "summary": "string | null",
  "skills": ["string"],
  "experience": [{ "company": "", "title": "", "startDate": "", "endDate": "", "description": "" }],
  "education": [{ "institution": "", "degree": "", "field": "", "startDate": "", "endDate": "" }],
  "certifications": ["string"],
  "languages": ["string"],
  "projects": [{ "name": "", "description": "", "technologies": ["string"] }]
}
```

## Error Handling

| Condition | Action |
|-----------|--------|
| Missing or invalid `file` / `userId` | HALT — report which input is invalid and what valid input looks like |
| Polling timeout (30 attempts × 3s = 90s) | Stop polling — report timeout with `jobId` for manual status check |
| BullMQ job `state === "failed"` | Report `failedReason` from job status to the user |
| Cloudinary upload failure | Propagated by `uploadResume` — report the error message |
| Ollama/LLM failure | Handled by `resume-parse.processor.ts` retry logic (2 attempts) — surfaces as job failure |

## Referenced Modules

- `backend/src/file-upload/file-upload.service.ts` — `uploadResume()`, `getParseJobStatus()`
- `backend/src/file-upload/resume-parse.processor.ts` — BullMQ worker (Ollama/Claude/LlamaParse)
- `backend/src/file-upload/ollama.helper.ts` — LLM structured extraction logic
