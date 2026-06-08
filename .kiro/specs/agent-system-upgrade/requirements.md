# Requirements Document

## Introduction

The Agent System Upgrade creates a production-grade set of Kiro configuration files (skills, steering, rules) that make the development agent operate deterministically across the Jobfinder pipeline: PDF data extraction → database storage → email automation with AI-generated templates. These files are additive — they do not rewrite any existing spec, steering, or rule files. They are modular, reusable, and optimized for real agent execution rather than tutorial-style documentation.

## Glossary

- **Agent**: The Kiro AI development agent that reads configuration files to execute tasks deterministically
- **Skill_File**: A markdown file in `.kiro/skills/` that defines a single, self-contained capability the Agent can invoke
- **Steering_File**: A markdown file in `.kiro/steering/` that defines execution flow, intent mapping, and orchestration rules
- **Rule_File**: A markdown file in `.kiro/rules/` that defines constraints the Agent must satisfy during execution
- **Execution_Pipeline**: The ordered sequence of skill invocations required to complete a user intent (PDF → Extract → Store → Email)
- **Intent_Detection**: The process by which the Steering_File maps a user request to one or more Skill_Files
- **PDF_Extraction_Skill**: The skill that orchestrates reading a PDF, calling Ollama for structured data extraction, and returning validated JSON
- **DB_Storage_Skill**: The skill that stores extracted candidate data into MongoDB via the existing users/resume pipeline
- **Email_Send_Skill**: The skill that sends emails using the existing mail module with resume attachment
- **Template_Generation_Skill**: The skill that generates personalized email templates via Ollama based on candidate and job context
- **Validation_Rules**: Constraints applied to inputs (email format, PDF integrity, deduplication) before skill execution
- **Output_Rules**: Constraints on agent response format (code as diffs, data as JSON, explanations capped at 5 lines)
- **Failure_Rules**: Constraints governing retry logic, error escalation, and when to stop or ask the user
- **Implementation_State**: The machine-readable module status document tracking what exists, what is partial, and what is missing

## Requirements

### Requirement 1: PDF Data Extraction Skill

**User Story:** As a developer using Kiro, I want a skill file that instructs the Agent to extract structured data from PDF resumes, so that the Agent executes the extraction pipeline correctly every time without manual guidance.

#### Acceptance Criteria

1. WHEN the user requests parsing or extracting data from a PDF resume, THE Agent SHALL read the skill file at `.kiro/skills/extract-pdf-data.md` and execute the PDF extraction pipeline defined within it
2. WHEN the skill is invoked, THE Agent SHALL follow the sequence: validate PDF input (file is PDF format, size ≤ 15 MB) and validate user ID (MongoDB ObjectId format) → call the existing `file-upload.service.ts` upload flow → trigger the `resume-parse.processor.ts` BullMQ job → poll the job status endpoint until state is "completed" or "failed" → return the parsed JSON result to the user
3. THE Skill_File SHALL reference the existing modules (`file-upload/`, `ollama.helper.ts`, `resume-parse.processor.ts`) by their actual file paths so the Agent knows which code to invoke
4. THE Skill_File SHALL define the expected input format (PDF file reference, user ID as MongoDB ObjectId) and the expected output format (structured JSON with fields: name, email, phone, location, summary, skills, experience, education, certifications, languages, projects)
5. IF the PDF extraction skill is invoked without a valid user ID (MongoDB ObjectId format) or without a file reference pointing to a PDF file, THEN THE Agent SHALL halt execution and report the specific missing or invalid input to the user without calling any backend services
6. THE Skill_File SHALL specify that the Agent must poll the BullMQ job status endpoint until the job state is "completed" or "failed", with a maximum of 30 poll attempts at 3-second intervals
7. IF the polling reaches 30 attempts without the job reaching "completed" or "failed" state, THEN THE Agent SHALL stop polling and report a timeout to the user, including the jobId for manual follow-up
8. IF the BullMQ job reaches "failed" state, THEN THE Agent SHALL report the failure reason from the job status response to the user
9. THE Skill_File SHALL be self-contained (executable without reading other skill files) and under 80 lines of markdown

### Requirement 2: Database Storage Skill

**User Story:** As a developer using Kiro, I want a skill file that instructs the Agent to store extracted candidate data into MongoDB, so that parsed resume data is persisted correctly using the existing repository pattern.

#### Acceptance Criteria

1. WHEN the user intent involves saving or persisting candidate/resume data, THE Agent SHALL read the skill file at `.kiro/skills/store-candidates-db.md` and execute the database storage flow described within it
2. WHEN the skill is invoked with parsed candidate data, THE Agent SHALL call the existing `users.service.ts` `saveResume` method to store resume data and trigger automatic profile population, or call `users.repository.ts` `updateProfile` method to update profile fields directly on an existing user document in MongoDB
3. THE Skill_File SHALL define the expected input as a JSON object containing at minimum `name` (string, required), `email` (string, required), and optionally the profile fields: `phone`, `location`, `headline`, `bio`, `linkedin`, `github`, `website`, `skills` (string array), `experience` (array of objects with company, title, startDate, endDate, description), `education` (array of objects with institution, degree, field, startDate, endDate), `certifications` (string array), `languages` (string array), and `projects` (array of objects with name, description, technologies); and the expected output as the stored MongoDB document including the generated `_id` field
4. THE Skill_File SHALL instruct the Agent to call `usersRepository.findByEmail` with the candidate's email (lowercased and trimmed) to check for an existing record before creating a new document via `usersRepository.create`
5. IF a record with the same email already exists, THEN THE Agent SHALL call `usersRepository.updateProfile` to merge the incoming profile fields into the existing record rather than creating a duplicate document
6. IF the parsed input is missing the required `name` or `email` fields, THEN THE Agent SHALL skip the database operation and return an error indication specifying which required fields are absent
7. THE Skill_File SHALL reference the `findByEmail` lookup method in `users.repository.ts` for existence checks and the `UserProfile` interface in `user.schema.ts` for profile field mapping
8. THE Skill_File SHALL be self-contained and under 60 lines of markdown

### Requirement 3: Email Send Skill

**User Story:** As a developer using Kiro, I want a skill file that instructs the Agent to send emails through the existing mail module, so that outreach emails are sent reliably with proper attachment handling.

#### Acceptance Criteria

1. THE Agent SHALL read the skill file at `.kiro/skills/send-email.md` and execute the email sending flow WHEN the user requests sending emails, outreach messages, or bulk mail to one or more recipients
2. WHEN the skill is invoked, THE Agent SHALL call the existing `mail.service.ts` `enqueueBulkMail` method with a `SendBulkMailDto` (containing `mailIds`, `subject`, `context`, optional `userId`, optional `from`) and an optional resume PDF file buffer
3. THE Skill_File SHALL define the expected input format (recipient list as an array of email address strings, subject line as a non-empty string, email body as a non-empty string, and either a resume PDF file or a userId whose Cloudinary-stored resume will be attached) and the expected output (a `jobId` string for status polling via `getJobStatus`, which returns state, progress, result with `sentCount`/`failedCount`, and `failedReason`)
4. THE Skill_File SHALL instruct the Agent to validate all recipient email addresses using the class-validator `@IsEmail` decorator rules (RFC 5322 compliant) before enqueuing the send job
5. IF any recipient email fails validation, THEN THE Agent SHALL exclude that recipient from the `mailIds` array, report each invalid entry to the user with the reason, and proceed with the remaining valid recipients only if at least 1 valid recipient remains
6. THE Skill_File SHALL reference the existing BullMQ queue configuration in `bull-redis.config.ts` and the mail processor in `mail.processor.ts`
7. THE Skill_File SHALL document the queue retry policy of 3 attempts with exponential backoff starting at 5 seconds, and specify a maximum of 50 recipients per single bulk mail invocation
8. THE Skill_File SHALL be self-contained and contain no more than 70 lines of markdown
9. IF the user provides neither a resume PDF file nor a userId, THEN THE Agent SHALL inform the user that one of the two is required and not enqueue the send job

### Requirement 4: AI Email Template Generation Skill

**User Story:** As a developer using Kiro, I want a skill file that instructs the Agent to generate personalized email templates via Ollama, so that outreach emails are contextually relevant to the recipient's role and company.

#### Acceptance Criteria

1. WHEN the user requests creating, generating, or drafting outreach email content, THE Agent SHALL read the skill file at `.kiro/skills/generate-email-template.md` and execute the template generation flow
2. WHEN the skill is invoked, THE Agent SHALL call Ollama using the existing connection pattern from `ollama.helper.ts` with a prompt containing: user profile summary (name, headline, skills, and experience from the UserProfile schema), recipient context (name, title, company), and optional user-provided instructions (maximum 500 characters)
3. THE Skill_File SHALL define the expected input format as: user profile data (name, headline, skills list, experience list), recipient context object (name as required, title as required, company as required), and optional custom prompt; and the expected output as plain-text email consisting of a subject line (non-empty, maximum 200 characters) and an email body (non-empty, maximum 2000 characters)
4. THE Skill_File SHALL specify the Ollama API endpoint pattern (`/api/generate`) with `stream: false` and model selection defaulting to the model configured in the existing environment
5. IF Ollama fails to respond within 30 seconds, THEN THE Agent SHALL retry once with a 5-second delay and, if the retry also fails, report the failure to the user with an error message indicating the Ollama service is unavailable and a suggestion to provide a manual template
6. THE Skill_File SHALL instruct the Agent to validate the generated output: subject must be non-empty and under 200 characters, body must be non-empty and under 2000 characters, and both must be plain text without HTML tags
7. IF the generated output fails validation, THEN THE Agent SHALL retry generation once with a simplified prompt (removing optional user instructions) and, if the retry also fails validation, report failure to the user with an error message indicating the generated content did not meet format constraints
8. IF any required recipient context field (name, title, or company) is missing or empty, THEN THE Agent SHALL report an error to the user indicating which required fields are missing before attempting generation
9. THE Skill_File SHALL support dynamic placeholders (`{{name}}`, `{{company}}`, `{{title}}`) in generated templates that remain as literal placeholder tokens in the output for later substitution by the caller
10. THE Skill_File SHALL be self-contained (no references to external files or dependencies beyond `ollama.helper.ts`) and under 80 lines of markdown

### Requirement 5: Execution Flow Steering

**User Story:** As a developer using Kiro, I want a steering file that maps user intents to the correct skill sequence, so that the Agent automatically orchestrates multi-step pipelines without manual intervention.

#### Acceptance Criteria

1. THE Agent SHALL read the steering file at `.kiro/steering/execution-flow.md` at the start of every user request and use its intent detection table to determine whether the request matches a defined pipeline intent before proceeding with skill invocation
2. THE Steering_File SHALL define an intent detection table where each row maps a set of keyword phrases (e.g., "parse resume", "extract pdf", "send outreach", "full pipeline") to an ordered skill sequence, with each keyword phrase being a case-insensitive substring match against the user's request text
3. THE Steering_File SHALL define at least 4 intent categories: (a) PDF extraction only (`extract-pdf-data`), (b) extraction + storage (`extract-pdf-data` → `store-candidates-db`), (c) email generation + send (`generate-email-template` → `send-email`), (d) full pipeline (`extract-pdf-data` → `store-candidates-db` → `generate-email-template` → `send-email`)
4. WHEN the Agent matches a multi-skill intent containing 2 or more skills in sequence, THE Agent SHALL execute each skill in the defined order and pass the complete output of the preceding skill as the primary input context to the next skill in the sequence
5. THE Steering_File SHALL define dependency rules: `store-candidates-db` requires output from `extract-pdf-data`; `send-email` requires output from `generate-email-template` or a user-provided template; `generate-email-template` requires user profile data (from DB or extraction)
6. IF a skill in the pipeline fails (returns an error or produces no output), THEN THE Agent SHALL halt the pipeline at the failure point, report to the user the list of skills that completed successfully with their outputs and the skill that failed with its error reason, and offer to retry the failed step
7. IF the user's request text does not match any keyword phrase in the intent detection table, THEN THE Agent SHALL proceed with normal LLM-assisted response without invoking any skill from the steering file
8. THE Steering_File SHALL be under 120 lines of markdown
9. IF a user's request text matches keyword phrases from multiple intent categories, THEN THE Agent SHALL select the intent category with the longest matching skill sequence that satisfies all matched keywords

### Requirement 6: Input Validation Rules

**User Story:** As a developer using Kiro, I want a rule file that enforces input validation before any skill execution, so that the Agent never processes invalid data and catches errors early.

#### Acceptance Criteria

1. THE Agent SHALL read the rule file at `.kiro/rules/validation.rules.md` and apply its constraints before executing any skill
2. THE Rule_File SHALL define email validation: reject any string that does not match the pattern `local@domain.tld` where the local part is 1-64 characters, the domain contains at least one dot and is 1-253 characters, and the entire string contains no whitespace
3. THE Rule_File SHALL define PDF validation: reject any file reference that does not end in `.pdf` (case-insensitive) or references a file exceeding 10MB
4. IF a user record with the same email already exists in the database, THEN THE Rule_File SHALL instruct the Agent to update the existing record's profile fields (name, resume data, and profile) rather than creating a duplicate entry
5. THE Rule_File SHALL define required field rules: for PDF extraction input, a non-empty user ID is required; for email send, at least one recipient matching the email validation pattern from criterion 2 is required; for template generation, user profile data containing at minimum a non-empty name and at least one skill is required
6. IF any validation rule fails, THEN THE Agent SHALL stop the current operation, report the rule number that failed, the input value that caused the failure, and a corrective action describing what valid input looks like
7. THE Rule_File SHALL be structured as a numbered checklist that the Agent evaluates sequentially before each skill invocation
8. THE Rule_File SHALL be under 60 lines of markdown
9. IF the rule file at `.kiro/rules/validation.rules.md` is missing or cannot be parsed as valid markdown, THEN THE Agent SHALL refuse to execute any skill and report that the validation rule file is unavailable

### Requirement 7: Output Format Rules

**User Story:** As a developer using Kiro, I want a rule file that constrains how the Agent formats its responses, so that outputs are consistent, minimal, and machine-parseable.

#### Acceptance Criteria

1. THE Agent SHALL read the rule file at `.kiro/rules/output.rules.md` and apply its formatting constraints to all responses generated while executing tasks defined by Kiro specs or requirements
2. THE Rule_File SHALL specify that code changes are presented as unified diffs (showing only modified lines with the relative file path on a dedicated line preceding each diff block), not full file contents
3. THE Rule_File SHALL specify that structured data outputs (extraction results, query results, status reports) are formatted as JSON
4. THE Rule_File SHALL specify that explanatory text is limited to a maximum of 5 lines (each line no longer than 120 characters) and uses direct, factual language without qualifiers such as "maybe", "perhaps", "I think", "it seems", or "probably"
5. THE Rule_File SHALL specify that error reports include exactly three fields: error type, affected component, and suggested resolution — formatted as one field per line (3 lines or fewer total)
6. WHEN multiple files are modified, THE Rule_File SHALL specify that each change is presented sequentially with a single summary line (maximum 80 characters) before the corresponding diff
7. THE Rule_File SHALL specify that the Agent does not repeat information present in the immediately preceding user message or any prior agent response within the same conversation session
8. THE Rule_File SHALL be under 50 lines of markdown
9. IF the rule file at `.kiro/rules/output.rules.md` is missing or cannot be parsed, THEN THE Agent SHALL proceed without output formatting constraints and include a single-line warning indicating the rule file was not loaded

### Requirement 8: Failure Handling Rules

**User Story:** As a developer using Kiro, I want a rule file that defines how the Agent handles errors, retries, and escalation, so that failures are resolved automatically when possible and escalated clearly when not.

#### Acceptance Criteria

1. WHEN an error occurs during skill execution, THE Agent SHALL read the rule file at `.kiro/rules/failure.rules.md` and follow the matching rule category to determine whether to retry, escalate, or report the failure
2. THE Rule_File SHALL define retry logic: for transient errors (network timeout exceeding 30 seconds, Ollama unresponsive, SMTP temporary failure with 4xx code), the Agent SHALL retry the failed operation once after a 5-second pause before escalating
3. THE Rule_File SHALL define stop conditions: after 2 consecutive failures on the same operation, the Agent SHALL stop retrying and present the user with a message stating the operation name, the number of failed attempts, and the last error encountered
4. THE Rule_File SHALL define escalation rules: when a failure requires user input (missing credentials, ambiguous intent, permission error), the Agent SHALL ask the user a question that includes the error category, the affected resource or operation, and a suggested resolution or list of options to choose from
5. THE Rule_File SHALL define partial success handling: when a batch operation (bulk email, multi-source scrape) partially fails, the Agent SHALL report a summary containing the count of succeeded items, the count of failed items, and for each failed item the item identifier and failure reason
6. THE Rule_File SHALL define the boundary between "fixable by Agent" and "requires user" as an explicit categorized list, where fixable items include typos in config, missing import statements, and wrong file paths, and user-required items include missing environment variables, external service outages, and architectural decisions
7. IF the Agent encounters an error not covered by any rule category, THEN THE Agent SHALL report the raw error with context (file, line, operation) and ask the user how to proceed
8. THE Rule_File SHALL be under 60 lines of markdown
9. IF the rule file at `.kiro/rules/failure.rules.md` is missing or contains invalid markdown that cannot be parsed, THEN THE Agent SHALL fall back to default behavior: report the raw error with context to the user and ask how to proceed without attempting automatic retries

### Requirement 9: Machine-Readable Implementation State

**User Story:** As a developer using Kiro, I want the implementation state document to include a machine-readable structured section, so that the Agent can programmatically determine module status without parsing prose.

#### Acceptance Criteria

1. THE Agent SHALL create a new file at `.kiro/specs/jobfinder-ai-system/implementation-state-structured.md` containing a machine-readable representation of module status (the existing `implementation-state.md` remains unchanged)
2. THE structured file SHALL represent each module as a block with fields: module name, path, status (implemented | partial | not-implemented), implemented features (list, may be empty), missing features (list, may be empty), and dependencies (list of other module names, may be empty)
3. THE structured file SHALL use fenced YAML code blocks (```yaml) as the single parseable format, where each module is a YAML object in a top-level `modules` array, so that the Agent can parse all module data using a standard YAML parser without ambiguity
4. THE structured file SHALL cover all modules listed in the existing `implementation-state.md`: Users, File Upload, Jobs, Mail, Logger, Frontend, Auth, Matching, Auto-Apply, Bulk Contact
5. WHEN the Agent reads the structured file, it SHALL be able to determine from each module's YAML block: (a) whether a module is ready to use by checking that its `status` field equals `implemented`, (b) what functions are available by reading the `implemented_features` list, and (c) what is missing by reading the `missing_features` list
6. THE structured file SHALL include a metadata header as the first YAML block with a `last_updated` field in ISO 8601 format (YYYY-MM-DDTHH:MM:SSZ) and a `version` field as an integer starting at 1 and incremented on each regeneration
7. THE structured file SHALL be under 200 lines total
