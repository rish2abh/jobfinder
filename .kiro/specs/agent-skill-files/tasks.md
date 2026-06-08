# Implementation Plan: Agent Skill Files

## Overview

Create four markdown skill files in `.kiro/skills/` that document specific Jobfinder workflows for the AI agent. Each file follows a consistent structure (Purpose, Relevant Files, Key Interfaces, Workflow Steps, Constraints, Expected Output) and references real source files and interfaces from the codebase. Implementation is straightforward file creation with no runtime code changes.

## Tasks

- [ ] 1. Create skill file for PDF resume extraction
  - [ ] 1.1 Create `extract-pdf-data.md` skill file
    - Create `.kiro/skills/extract-pdf-data.md` with a level-1 heading "Extract PDF Data"
    - Write the Purpose section describing the Ollama-based PDF resume extraction pipeline
    - Write the Relevant Files section listing all FileUpload module source files (`file-upload.controller.ts`, `file-upload.service.ts`, `resume-parse.processor.ts`, `ollama.helper.ts`, `resume-job.types.ts`, `dto/upload-resume.dto.ts`)
    - Write the Key Interfaces section with TypeScript code blocks for `ResumeParseJobData`, `ResumeParseJobResult`, `OllamaParseResult`, and the resume JSON output schema
    - Write the Workflow Steps section covering: PDF upload to Cloudinary, text extraction via pdf-parse, BullMQ job enqueue on `resume-parse` queue, Ollama LLM call with 3-attempt retry and escalating prompts, JSON cleaning/validation, persistence via UsersService, and reparse capability
    - Write the Constraints section documenting text truncation limits (6000/4000/4000 chars per attempt), retry backoff (`2000ms * attemptNumber`), 5-minute Ollama timeout, temperature 0, and fallback skeleton with `_parseError` metadata
    - Write the Expected Output section describing the structured JSON object with all 11 fields
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_

- [ ] 2. Create skill file for candidate database persistence
  - [ ] 2.1 Create `store-candidates-db.md` skill file
    - Create `.kiro/skills/store-candidates-db.md` with a level-1 heading "Store Candidates DB"
    - Write the Purpose section describing MongoDB persistence via the Users module repository pattern
    - Write the Relevant Files section listing all Users module source files (`users.controller.ts`, `users.service.ts`, `users.repository.ts`, `user.schema.ts`, `profile-extractor.ts`, `users.module.ts`, `dto/create-user.dto.ts`, `dto/update-profile.dto.ts`, `dto/mongo-id-param.dto.ts`)
    - Write the Key Interfaces section with TypeScript code blocks for `UserDocument`, `UserProfile`, `ExperienceItem`, `EducationItem`, `ProjectItem`, `RefreshTokenEntry`, `CreateUserDto`, `UpdateProfileDto`, `ExperienceItemDto`, `EducationItemDto`, and `ProjectItemDto`
    - Write the Workflow Steps section covering: validate user existence, archive existing resume to `resumeVersions`, call `saveResume`, auto-extract profile via `extractProfileFromParsedJson`, fallback to regex extraction via `extractProfileFromRawText`, merge profile updates via `updateProfile`
    - Write the Constraints section documenting unique email index, resume vs profile separation, `lastUpdatedFrom` tracking, repository pattern requirement, and full-replace behavior for array fields
    - Write the Expected Output section describing the persisted User document with all relevant fields populated
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_

- [ ] 3. Create skill file for email sending
  - [ ] 3.1 Create `send-email.md` skill file
    - Create `.kiro/skills/send-email.md` with a level-1 heading "Send Email"
    - Write the Purpose section describing Nodemailer SMTP sending with BullMQ rate-limited queuing for bulk and template-based sends
    - Write the Relevant Files section listing all Mail module source files (`mail.module.ts`, `mail.controller.ts`, `mail.service.ts`, `mail.processor.ts`, `mail-from.schema.ts`, `mail-from.service.ts`, `mail-job.types.ts`, `mail-result.schema.ts`, `bull-redis.config.ts`, `dto/send-bulk-mail.dto.ts`)
    - Write the Key Interfaces section with TypeScript code blocks for `BulkMailJobData`, `BulkMailJobResult`, `TemplateMailJobData`, `TemplateMailJobResult`, `SendBulkMailDto`, `MailResult` schema, and queue constants
    - Write the Workflow Steps section covering: resolve sender address via MailFromService, create Nodemailer transporter, resolve attachment, send via transporter, track per-recipient results for template sends, return aggregated counts for bulk sends
    - Write the Constraints section documenting rate limit (5 per 60s), required SMTP env vars, exponential backoff retry (3 attempts, 5000ms base), 24-hour completed job retention, 7-day failed job retention
    - Write the Expected Output section describing the immediate `{ jobId, status: "queued" }` response and polling endpoint
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_

- [ ] 4. Create skill file for email template generation
  - [ ] 4.1 Create `generate-email-template.md` skill file
    - Create `.kiro/skills/generate-email-template.md` with a level-1 heading "Generate Email Template"
    - Write the Purpose section describing AI-powered template generation using Ollama with upsert caching and manual editing support
    - Write the Relevant Files section listing all BulkContact module source files (`template-generator.service.ts`, `personalization.service.ts`, `bulk-contact.controller.ts`, `bulk-contact.service.ts`, `email-template.schema.ts`, `contact-group.schema.ts`, `dto/generate-templates.dto.ts`, `dto/edit-template.dto.ts`)
    - Write the Key Interfaces section with TypeScript code blocks for `EmailTemplate`, `EmailTemplateDocument`, `ContactGroup`, `ContactGroupDocument`, `TemplateInput`, `RecipientInput`, `PersonalizedOutput`, and `GenerateTemplatesDto`
    - Write the Workflow Steps section covering: check cache by groupId, build profile summary, construct Ollama prompt, call Ollama with stream false / temperature 0.7 / num_predict 1200 / 60s timeout, parse JSON response with regex fallback, cache via findOneAndUpdate with upsert, fallback to manual placeholder on failure
    - Write the Constraints section documenting 200-char subject limit, 2000-char body limit, placeholder tokens (`{{name}}`, `{{company}}`, `{{title}}`), case-insensitive replacement, upsert keyed on groupId, OLLAMA_URL and OLLAMA_MODEL env vars
    - Write the Expected Output section describing the `EmailTemplateDocument` with all fields
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_

- [ ] 5. Checkpoint - Verify all skill files exist and follow consistent structure
  - Ensure all four skill files exist at their expected paths in `.kiro/skills/`
  - Verify each file follows the fixed section order: Purpose → Relevant Files → Key Interfaces → Workflow Steps → Constraints → Expected Output
  - Verify all TypeScript interfaces use fenced code blocks and file paths use inline code
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Write structural validation tests
  - [ ] 6.1 Create Jest test file for skill file validation
    - Create a test file at `backend/src/test/skill-files.spec.ts` (or appropriate test location)
    - Write test cases that read each skill file and verify:
      - File exists at expected path
      - Contains level-1 heading matching filename stem in title case
      - Contains all six required level-2 sections in correct order
      - "Relevant Files" section has at least one bullet item with inline code path
      - "Workflow Steps" section has at least two numbered steps
      - "Constraints" section has at least one bullet item
      - TypeScript code blocks are present in "Key Interfaces" section
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_

- [ ] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- This feature produces static markdown documentation files, not executable code
- No property-based tests are needed — the design explicitly states PBT does not apply to static documentation artifacts
- Testing uses structural validation (file existence, section presence, heading levels, formatting)
- Each skill file is self-contained and references only its own module's source files
- The project uses Jest as its test runner (configured in the backend)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1", "4.1"] },
    { "id": 1, "tasks": ["6.1"] }
  ]
}
```
