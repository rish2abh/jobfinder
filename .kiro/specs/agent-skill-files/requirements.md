# Requirements Document

## Introduction

This feature defines four Kiro skill files placed in `.kiro/skills/` that provide structured instructions to the AI agent when performing specific workflows in the Jobfinder project. Each skill file documents the purpose, relevant modules, key interfaces, workflow steps, constraints, and expected outputs for a particular domain task: extracting PDF resume data, storing candidate data in MongoDB, sending emails via the mail pipeline, and generating AI-powered email templates.

## Glossary

- **Skill_File**: A markdown file in `.kiro/skills/` that provides the AI agent with context and step-by-step instructions for executing a specific workflow
- **Agent**: The AI coding assistant (Kiro) that reads skill files to understand how to perform domain-specific tasks in the codebase
- **Ollama_Pipeline**: The local LLM integration using the Ollama `/api/generate` endpoint with retry logic and JSON extraction for structured data output
- **Users_Module**: The NestJS module at `backend/src/users/` responsible for user profile management, resume storage, and MongoDB persistence via the repository pattern
- **Mail_Module**: The NestJS module at `backend/src/mail/` responsible for bulk email sending via Nodemailer with BullMQ rate-limited queuing
- **BulkContact_Module**: The NestJS module at `backend/src/bulk-contact/` responsible for contact parsing, grouping, AI template generation, personalization, and triggering bulk sends
- **FileUpload_Module**: The NestJS module at `backend/src/file-upload/` responsible for PDF upload to Cloudinary, text extraction via pdf-parse, and LLM-based resume parsing
- **BullMQ_Queue**: A Redis-backed job queue used for async processing of long-running tasks (resume parsing, email sending, job scraping)
- **Workflow_Steps**: An ordered sequence of actions the Agent follows when executing a skill, including file reads, code modifications, and validations

## Requirements

### Requirement 1: Extract PDF Data Skill File

**User Story:** As a developer using Kiro, I want a skill file that guides the agent through the PDF resume extraction workflow, so that the agent produces correct code changes when modifying or extending the Ollama-based parsing pipeline.

#### Acceptance Criteria

1. THE Skill_File SHALL exist at the path `.kiro/skills/extract-pdf-data.md`
2. THE Skill_File SHALL document the purpose of the PDF extraction pipeline as extracting structured JSON data from uploaded PDF resumes using Ollama via the native `/api/generate` endpoint
3. THE Skill_File SHALL list all source files in the FileUpload_Module including `file-upload.controller.ts`, `file-upload.service.ts`, `resume-parse.processor.ts`, `ollama.helper.ts`, `resume-job.types.ts`, and `dto/upload-resume.dto.ts`
4. THE Skill_File SHALL document the key interfaces including `ResumeParseJobData` (with fields userId, cloudinaryUrl, cloudinaryId, rawText, pdfBase64), `ResumeParseJobResult` (with fields userId, cloudinaryUrl, rawText, parsedJson, llmAttempts), `OllamaParseResult` (with fields parsedJson, llmAttempts, rawText), and the expected JSON output schema containing name, email, phone, location, summary, skills, experience, education, certifications, languages, and projects
5. THE Skill_File SHALL describe the workflow steps in order: PDF upload to Cloudinary (resource_type `raw`, max file size 15 MB), text extraction via pdf-parse, enqueue BullMQ job on queue `resume-parse` with job name `parse-resume`, Ollama LLM call with 3-attempt retry loop using escalating prompts, JSON cleaning and validation (strip markdown fences, extract outermost braces, repair trailing commas, verify presence of resume fields), and persistence to MongoDB via UsersService
6. THE Skill_File SHALL document constraints including the per-attempt text truncation limits (6000 characters on attempt 1, 4000 on attempt 2, 4000 on attempt 3), the 3-attempt LLM retry strategy with `2000ms * attemptNumber` backoff delay between attempts, the 5-minute (300000 ms) Ollama HTTP timeout, temperature 0 for deterministic output, and a fallback skeleton containing null fields plus `_parseError` and `_rawLlmOutput` metadata when all parse attempts fail
7. THE Skill_File SHALL specify that the expected output is a structured JSON object containing name, email, phone, location, summary, skills (array of strings), experience (array of objects with company, title, startDate, endDate, description), education (array of objects with institution, degree, field, startDate, endDate), certifications (array of strings), languages (array of strings), and projects (array of objects with name, description, technologies)
8. THE Skill_File SHALL document the reparse capability that allows re-triggering LLM parsing on previously stored rawText without requiring a new PDF upload, using the same queue and retry logic

### Requirement 2: Store Candidates in Database Skill File

**User Story:** As a developer using Kiro, I want a skill file that guides the agent through storing parsed candidate data into MongoDB, so that the agent correctly interfaces with the Users module when making persistence-related changes.

#### Acceptance Criteria

1. THE Skill_File SHALL exist at the path `.kiro/skills/store-candidates-db.md`
2. THE Skill_File SHALL document the purpose as persisting parsed resume data and user profile information into MongoDB via the Users module repository pattern
3. THE Skill_File SHALL list all relevant source files in the Users_Module including `users.controller.ts`, `users.service.ts`, `users.repository.ts`, `user.schema.ts`, `profile-extractor.ts`, `users.module.ts`, and the DTO files `create-user.dto.ts`, `update-profile.dto.ts`, and `mongo-id-param.dto.ts`
4. THE Skill_File SHALL document the key interfaces including `UserDocument`, `UserProfile`, `ExperienceItem`, `EducationItem`, `ProjectItem`, `RefreshTokenEntry`, `CreateUserDto`, `UpdateProfileDto`, `ExperienceItemDto`, `EducationItemDto`, and `ProjectItemDto`
5. THE Skill_File SHALL describe the workflow steps for storing candidate data: validate user existence via `findById`, archive the existing resume into `resumeVersions` if the user already has resume data, call `saveResume` with parsed JSON and Cloudinary metadata, auto-extract profile fields from parsed JSON via `extractProfileFromParsedJson`, fall back to regex-based raw text extraction via `extractProfileFromRawText` if the JSON extraction yields zero skills and zero experience items, and merge profile updates via `updateProfile`
6. THE Skill_File SHALL document constraints including the unique email index on users, the separation between `resume` (raw parse output) and `profile` (structured editable fields), the `lastUpdatedFrom` tracking with values `resume_parse`, `raw_text_extract`, or `manual`, the repository pattern requirement for all database operations, and that profile array fields (skills, experience, education, certifications, languages, projects) are replaced in full rather than merged on update
7. THE Skill_File SHALL specify that the expected output is a persisted User document with populated `resume`, `resumeRawText`, `resumeCloudinaryUrl`, `resumeCloudinaryId`, and `profile` fields, and that any previously existing resume data is preserved in the `resumeVersions` array

### Requirement 3: Send Email Skill File

**User Story:** As a developer using Kiro, I want a skill file that guides the agent through the email sending workflow, so that the agent correctly uses the Mail module with its SMTP configuration and BullMQ rate-limited queue when implementing email-related features.

#### Acceptance Criteria

1. THE Skill_File SHALL exist at the path `.kiro/skills/send-email.md`
2. THE Skill_File SHALL document the purpose as sending emails via Nodemailer SMTP with BullMQ rate-limited queuing for both legacy bulk sends (multiple recipients per job via `send-bulk-mail` job) and template-based per-recipient sends (one recipient per job via `send-template-email` job)
3. THE Skill_File SHALL list all relevant source files in the Mail_Module including `mail.module.ts`, `mail.controller.ts`, `mail.service.ts`, `mail.processor.ts`, `mail-from.schema.ts`, `mail-from.service.ts`, `mail-job.types.ts`, `mail-result.schema.ts`, `bull-redis.config.ts`, and `dto/send-bulk-mail.dto.ts`
4. THE Skill_File SHALL document the key interfaces including `BulkMailJobData`, `BulkMailJobResult`, `TemplateMailJobData`, `TemplateMailJobResult`, `SendBulkMailDto`, the `MailResult` Mongoose schema, and the queue constants `MAIL_QUEUE`, `MAIL_JOB`, and `TEMPLATE_MAIL_JOB`
5. THE Skill_File SHALL describe the workflow steps for sending email: resolve sender address via MailFromService (checking provided address, then active address in DB, then SMTP_FROM or SMTP_USER fallback), create Nodemailer transporter from SMTP env vars, resolve attachment (uploaded base64 buffer for bulk sends, or Cloudinary URL fetch for template sends, or user profile resume as final fallback), send via transporter, track per-recipient results in the MailResult collection for template sends, and return aggregated success/failure counts for bulk sends
6. THE Skill_File SHALL document constraints including the rate limit of 5 emails per 60 seconds via BullMQ limiter configuration, the required environment variables SMTP_HOST, SMTP_USER, and SMTP_PASS (plus optional SMTP_PORT defaulting to 587 and SMTP_SECURE), the exponential backoff retry strategy of 3 attempts with 5000ms base delay, the 24-hour completed job retention, and the 7-day failed job retention
7. THE Skill_File SHALL specify that the expected output is a JSON object containing a `jobId` string and `status: "queued"` returned immediately to the client, with final results available via polling `GET /mail/bulk/status/:jobId` which returns the job state, result counts, failure reason, and attempts made

### Requirement 4: Generate Email Template Skill File

**User Story:** As a developer using Kiro, I want a skill file that guides the agent through AI-powered email template generation, so that the agent correctly uses the Ollama integration in the BulkContact module for personalized recruiter outreach templates.

#### Acceptance Criteria

1. THE Skill_File SHALL exist at the path `.kiro/skills/generate-email-template.md`
2. THE Skill_File SHALL document the purpose as generating personalized cold outreach email templates using Ollama for grouped contacts, with upsert-based MongoDB caching and manual editing support via the `saveManualTemplate` method
3. THE Skill_File SHALL list all source files in the BulkContact_Module including `template-generator.service.ts`, `personalization.service.ts`, `bulk-contact.controller.ts`, `bulk-contact.service.ts`, `email-template.schema.ts`, `contact-group.schema.ts`, and the DTOs `generate-templates.dto.ts` and `edit-template.dto.ts`
4. THE Skill_File SHALL document the key interfaces including `EmailTemplate`, `EmailTemplateDocument`, `ContactGroup`, `ContactGroupDocument`, `TemplateInput`, `RecipientInput`, `PersonalizedOutput`, and the `GenerateTemplatesDto`
5. THE Skill_File SHALL describe the workflow steps for template generation: check cache by querying `emailTemplateModel.findOne({ groupId })` for an existing template, build a profile summary from user data fields (name, headline, bio, skills limited to the first 10, and location), construct an Ollama prompt with group context (groupType of 'title' or 'company' and groupValue) and personalization rules, call Ollama `/api/generate` with the configured model (defaulting to 'mistral'), `stream: false`, temperature 0.7, `num_predict: 1200`, and a 60-second timeout, parse the JSON response by extracting the first `{` to last `}` substring and parsing subject and body keys with a fallback regex extraction if JSON parsing fails, cache the result in MongoDB via `findOneAndUpdate` with upsert, and fall back to a manual input placeholder with empty subject and body on Ollama failure
6. THE Skill_File SHALL document constraints including the 200-character subject limit, 2000-character body limit enforced via `.slice(0, N)` on both AI and manual paths, the `{{name}}`, `{{company}}`, and `{{title}}` placeholder tokens for personalization, the case-insensitive placeholder replacement using regex with the `gi` flag, the upsert-based caching strategy keyed on `groupId` with a unique index, and the fallback to `generatedBy: 'manual'` with empty subject and body strings when Ollama fails
7. THE Skill_File SHALL specify that the expected output is an `EmailTemplateDocument` with fields `groupId`, `userId`, `subject`, `body`, `generatedBy` (either 'ai' or 'manual'), and `cachedAt`, where AI-generated templates have populated subject and body and manual-fallback templates have empty strings for both fields
8. THE Skill_File SHALL document that the Ollama connection URL and model name are configurable via the `OLLAMA_URL` environment variable (defaulting to `http://localhost:11434`) and the `OLLAMA_MODEL` environment variable (defaulting to `mistral`)

### Requirement 5: Skill File Structure Consistency

**User Story:** As a developer using Kiro, I want all skill files to follow a consistent structure, so that the agent can predictably locate information within any skill file.

#### Acceptance Criteria

1. WHEN a Skill_File is created, THE Skill_File SHALL contain a level-1 heading (`#`) with the skill name matching the filename stem in title case (e.g., `extract-pdf-data.md` → "Extract PDF Data")
2. WHEN a Skill_File is created, THE Skill_File SHALL contain a level-2 heading (`##`) "Purpose" section describing what the skill accomplishes in one to three sentences
3. WHEN a Skill_File is created, THE Skill_File SHALL contain a level-2 heading (`##`) "Relevant Files" section listing at least one source file as a markdown bullet list, where each entry contains the file's relative path from the project root formatted as inline code
4. WHEN a Skill_File is created, THE Skill_File SHALL contain a level-2 heading (`##`) "Key Interfaces" section documenting each TypeScript interface or type with its name and a one-sentence description of its role, using markdown code blocks for interface definitions
5. WHEN a Skill_File is created, THE Skill_File SHALL contain a level-2 heading (`##`) "Workflow Steps" section with a numbered list of at least two steps describing the execution order from trigger to completion
6. WHEN a Skill_File is created, THE Skill_File SHALL contain a level-2 heading (`##`) "Constraints" section listing at least one technical limitation or rule as a markdown bullet list
7. WHEN a Skill_File is created, THE Skill_File SHALL contain a level-2 heading (`##`) "Expected Output" section describing the successful result of executing the workflow in one to three sentences
8. WHEN a Skill_File is created, THE Skill_File SHALL present its sections in the following fixed order: Purpose, Relevant Files, Key Interfaces, Workflow Steps, Constraints, Expected Output
9. WHEN a Skill_File is created, THE Skill_File SHALL use markdown fenced code blocks (triple backticks) for all TypeScript interface definitions and inline code (single backticks) for file paths and type names within prose
