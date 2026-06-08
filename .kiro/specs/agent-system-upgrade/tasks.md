# Implementation Plan: Agent System Upgrade

## Overview

Create production-grade Kiro configuration files (skills, steering, rules) that make the development agent operate deterministically across the Jobfinder pipeline. Files are created in dependency order: validation rules first (referenced by all skills), then skills in pipeline order, then steering (references all skills), then implementation state, and finally property-based tests.

## Tasks

- [x] 1. Create rule files (foundational — referenced by all skills)
  - [x] 1.1 Create validation.rules.md
    - Create `.kiro/rules/validation.rules.md` with numbered checklist of validation constraints
    - Include email validation (local@domain.tld pattern, local 1-64 chars, domain ≥1 dot 1-253 chars, no whitespace)
    - Include PDF validation (extension ends `.pdf` case-insensitive, size ≤10MB)
    - Include deduplication rule (existing email → update, never duplicate)
    - Include required fields per skill (userId for PDF, name+email for DB, ≥1 valid recipient for email, name+≥1 skill for template, name+title+company for recipient context)
    - Include failure reporting format (rule number, failing value, corrective action)
    - Keep under 60 lines of markdown
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

  - [x] 1.2 Create output.rules.md
    - Create `.kiro/rules/output.rules.md` with formatting constraints
    - Code changes → unified diffs with relative file path header
    - Structured data → JSON format
    - Explanatory text → max 5 lines × 120 chars, no qualifiers
    - Error reports → 3 fields: error type, affected component, suggested resolution
    - Multi-file changes → summary line (≤80 chars) before each diff
    - No repetition of prior message info
    - Keep under 50 lines of markdown
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_

  - [x] 1.3 Create failure.rules.md
    - Create `.kiro/rules/failure.rules.md` with categorized error handling rules
    - Transient errors (network timeout >30s, Ollama unresponsive, SMTP 4xx) → retry once after 5s
    - Stop condition: 2 consecutive failures → stop, report operation name + attempt count + last error
    - Escalation: user input required → ask with error category + affected resource + suggested resolution
    - Partial success: report succeeded count, failed count, per-item failure reasons
    - Agent-fixable vs user-required boundary as explicit categorized list
    - Uncategorized errors → report raw error with file/line/operation context, ask user
    - Keep under 60 lines of markdown
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

- [x] 2. Checkpoint - Validate rule files
  - Ensure all three rule files exist, are under their line limits, and contain all required sections. Ask the user if questions arise.

- [x] 3. Create skill files (in pipeline execution order)
  - [x] 3.1 Create extract-pdf-data.md skill
    - Create `.kiro/skills/extract-pdf-data.md` with uniform skill structure (Trigger, Inputs, Steps, Output, Error Handling)
    - Trigger: user requests parsing/extracting data from a PDF resume
    - Inputs: `file` (PDF, ≤15MB), `userId` (MongoDB ObjectId)
    - Steps: validate inputs → call `file-upload.service.ts::uploadResume(file, userId)` → poll `getParseJobStatus(jobId)` every 3s up to 30 times → return parsed JSON
    - Output: structured JSON (name, email, phone, location, summary, skills, experience, education, certifications, languages, projects)
    - Reference actual file paths: `backend/src/file-upload/file-upload.service.ts`, `backend/src/file-upload/resume-parse.processor.ts`, `backend/src/file-upload/ollama.helper.ts`
    - Include error handling: polling timeout (30 attempts), BullMQ job failure reporting
    - Keep self-contained and under 80 lines
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9_

  - [x] 3.2 Create store-candidates-db.md skill
    - Create `.kiro/skills/store-candidates-db.md` with uniform skill structure
    - Trigger: user intent involves saving/persisting candidate or resume data
    - Inputs: JSON object with `name` (required), `email` (required), and optional profile fields matching `UserProfile` interface
    - Steps: validate required fields → `usersRepository.findByEmail(email.toLowerCase().trim())` → if exists: updateProfile → if new: create then updateProfile → return stored document with `_id`
    - Reference: `backend/src/users/users.repository.ts`, `backend/src/users/user.schema.ts`
    - Keep self-contained and under 60 lines
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [x] 3.3 Create generate-email-template.md skill
    - Create `.kiro/skills/generate-email-template.md` with uniform skill structure
    - Trigger: user requests creating/generating/drafting outreach email content
    - Inputs: user profile data (name, headline, skills, experience), recipient context (name, title, company — all required), optional custom prompt (≤500 chars)
    - Steps: validate recipient context → build prompt → POST to Ollama `/api/generate` with `stream: false` → validate output (subject ≤200 chars, body ≤2000 chars, no HTML) → return plain-text email with placeholders
    - Include retry logic: 30s timeout → retry once after 5s → report failure with manual template suggestion
    - Support `{{name}}`, `{{company}}`, `{{title}}` placeholders
    - Reference: `backend/src/file-upload/ollama.helper.ts` (connection pattern)
    - Keep self-contained and under 80 lines
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10_

  - [x] 3.4 Create send-email.md skill
    - Create `.kiro/skills/send-email.md` with uniform skill structure
    - Trigger: user requests sending emails, outreach messages, or bulk mail
    - Inputs: `mailIds` (string[], RFC 5322 emails), `subject` (non-empty), `context` (non-empty body), `userId` or resume PDF file
    - Steps: validate emails using `@IsEmail` rules → exclude invalid, report them → call `mail.service.ts::enqueueBulkMail(dto, resume?)` → return `jobId`
    - Output: `{ jobId: string }` for status polling
    - Constraints: max 50 recipients, retry policy 3 attempts / exponential backoff from 5s
    - Reference: `backend/src/mail/mail.service.ts`, `backend/src/mail/mail.processor.ts`, `backend/src/mail/bull-redis.config.ts`
    - Keep self-contained and under 70 lines
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

- [x] 4. Checkpoint - Validate skill files
  - Ensure all four skill files exist, are under their line limits, follow the uniform structure (Trigger, Inputs, Steps, Output, Error Handling), and reference correct file paths. Ask the user if questions arise.

- [x] 5. Create steering file
  - [x] 5.1 Create execution-flow.md steering file
    - Create `.kiro/steering/execution-flow.md` with intent detection and routing logic
    - Define intent detection table with 4+ categories: PDF extraction only, Extract + Store, Email generation + Send, Full pipeline
    - Define keyword patterns for each category (case-insensitive substring matching)
    - Define ordered skill sequences for each intent category
    - Define dependency rules: `store-candidates-db` requires `extract-pdf-data` output; `send-email` requires `generate-email-template` output or user template; `generate-email-template` requires user profile data
    - Define conflict resolution: multiple matches → select longest skill sequence
    - Define pipeline execution: pass complete output of skill K as input to skill K+1
    - Define failure handling: halt at failure point, report completed/failed skills
    - Define no-match behavior: proceed with normal LLM response
    - Keep under 120 lines
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_

- [x] 6. Create implementation state file
  - [x] 6.1 Create implementation-state-structured.md
    - Create `.kiro/specs/jobfinder-ai-system/implementation-state-structured.md`
    - Include metadata YAML block with `last_updated` (ISO 8601) and `version` (integer starting at 1)
    - Include modules YAML array covering all 10 modules: Users, File Upload, Jobs, Mail, Logger, Frontend, Auth, Matching, Auto-Apply, Bulk Contact
    - Each module entry: `name`, `path`, `status` (implemented | partial | not-implemented), `implemented_features` (list), `missing_features` (list), `dependencies` (list)
    - Keep under 200 lines total
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

- [x] 7. Checkpoint - Validate all configuration files
  - Ensure all 9 configuration files exist at their correct paths, are under line limits, and cross-references between files are consistent. Ask the user if questions arise.

- [x] 8. Implement property-based tests for intent detection and validation
  - [x] 8.1 Create test infrastructure and helpers
    - Create `backend/src/agent-config/__tests__/helpers/` directory with shared test utilities
    - Create arbitraries for: valid/invalid emails, PDF file references, MongoDB ObjectIds, user profile data, recipient contexts, intent request strings
    - Install `fast-check` if not already present in backend devDependencies
    - _Requirements: 6.2, 6.3, 6.5_

  - [ ]* 8.2 Write property test for intent detection routing (Property 1)
    - **Property 1: Intent Detection Routing**
    - Create `backend/src/agent-config/__tests__/intent-detection.pbt.spec.ts`
    - For any request string containing keywords from an intent category, verify the correct skill sequence is returned
    - Use fast-check arbitraries generating request strings with embedded keywords
    - Minimum 100 iterations
    - **Validates: Requirements 1.1, 2.1, 3.1, 4.1, 5.2**

  - [ ]* 8.3 Write property test for email validation correctness (Property 2)
    - **Property 2: Email Validation Correctness**
    - Create `backend/src/agent-config/__tests__/email-validation.pbt.spec.ts`
    - For any string, the validation accepts iff it matches local@domain.tld pattern with correct constraints
    - Generate both valid and invalid email strings with fast-check
    - Minimum 100 iterations
    - **Validates: Requirements 3.4, 6.2**

  - [ ]* 8.4 Write property test for email list partitioning (Property 3)
    - **Property 3: Email List Partitioning**
    - In same test file as Property 2
    - For any mixed list, partition into accepted/rejected sets with no overlap and complete coverage
    - Minimum 100 iterations
    - **Validates: Requirements 3.5**

  - [ ]* 8.5 Write property test for required field validation (Property 4)
    - **Property 4: Required Field Validation Per Skill**
    - Create `backend/src/agent-config/__tests__/field-validation.pbt.spec.ts`
    - For any skill input missing required fields, validation rejects and identifies missing fields
    - Generate partial inputs for each skill type
    - Minimum 100 iterations
    - **Validates: Requirements 1.5, 2.6, 4.8, 6.5**

  - [ ]* 8.6 Write property test for PDF validation (Property 16)
    - **Property 16: PDF Validation**
    - In same test file as Property 4
    - For any file reference, accepts iff filename ends `.pdf` (case-insensitive) and size ≤10MB
    - Minimum 100 iterations
    - **Validates: Requirements 6.3**

- [x] 9. Implement property-based tests for database and pipeline logic
  - [ ]* 9.1 Write property test for deduplication (Property 5)
    - **Property 5: Deduplication — Update Not Duplicate**
    - Create `backend/src/agent-config/__tests__/deduplication.pbt.spec.ts`
    - For any candidate where email matches existing record (lowercased, trimmed), verify update occurs, no new document created
    - Minimum 100 iterations
    - **Validates: Requirements 2.4, 2.5, 6.4**

  - [ ]* 9.2 Write property test for pipeline output chaining (Property 6)
    - **Property 6: Pipeline Output Chaining**
    - Create `backend/src/agent-config/__tests__/pipeline-orchestration.pbt.spec.ts`
    - For any multi-skill pipeline of length N≥2, verify skill K+1 receives complete output of skill K
    - Minimum 100 iterations
    - **Validates: Requirements 5.4**

  - [ ]* 9.3 Write property test for pipeline dependency enforcement (Property 7)
    - **Property 7: Pipeline Dependency Enforcement**
    - In same test file as Property 6
    - Attempting to execute a skill without required predecessor output results in dependency error
    - Minimum 100 iterations
    - **Validates: Requirements 5.5**

  - [ ]* 9.4 Write property test for pipeline failure halting (Property 8)
    - **Property 8: Pipeline Failure Halting**
    - In same test file as Property 6
    - When skill K fails, report completed skills before K, failed skill K, and not-attempted skills after K
    - Minimum 100 iterations
    - **Validates: Requirements 5.6**

- [x] 10. Implement property-based tests for intent edge cases and template validation
  - [ ]* 10.1 Write property test for no-match intent bypass (Property 9)
    - **Property 9: No-Match Intent Bypass**
    - In same test file as Property 1 (intent-detection.pbt.spec.ts)
    - For any request not containing any keyword phrase, no skill is invoked
    - Minimum 100 iterations
    - **Validates: Requirements 5.7**

  - [ ]* 10.2 Write property test for multi-match conflict resolution (Property 10)
    - **Property 10: Multi-Match Conflict Resolution**
    - In same test file as Property 1
    - When multiple categories match, select the one with the longest skill sequence
    - Minimum 100 iterations
    - **Validates: Requirements 5.9**

  - [ ]* 10.3 Write property test for template output validation (Property 11)
    - **Property 11: Template Output Validation**
    - Create `backend/src/agent-config/__tests__/template-validation.pbt.spec.ts`
    - For any template output, accept iff subject non-empty ≤200 chars, body non-empty ≤2000 chars, no HTML
    - Minimum 100 iterations
    - **Validates: Requirements 4.6**

- [x] 11. Implement property-based tests for error handling and state validation
  - [ ]* 11.1 Write property test for validation failure reporting (Property 12)
    - **Property 12: Validation Failure Reporting**
    - Create `backend/src/agent-config/__tests__/error-handling.pbt.spec.ts`
    - For any validation failure, report contains exactly: rule number, failing value, corrective action
    - Minimum 100 iterations
    - **Validates: Requirements 6.6**

  - [ ]* 11.2 Write property test for error classification (Property 13)
    - **Property 13: Error Classification**
    - In same test file as Property 12
    - For any error, classify into exactly one category: transient, agent-fixable, or user-required
    - Minimum 100 iterations
    - **Validates: Requirements 8.1, 8.6**

  - [ ]* 11.3 Write property test for retry and stop logic (Property 14)
    - **Property 14: Retry and Stop Logic**
    - In same test file as Property 12
    - Transient errors → retry once after 5s. Two consecutive failures → stop and report
    - Minimum 100 iterations
    - **Validates: Requirements 8.2, 8.3**

  - [ ]* 11.4 Write property test for partial success reporting (Property 15)
    - **Property 15: Partial Success Reporting**
    - In same test file as Property 12
    - For batch with S successes and F failures (S+F=N), report exact counts and per-item failure reasons
    - Minimum 100 iterations
    - **Validates: Requirements 8.5**

  - [ ]* 11.5 Write property test for implementation state schema validity (Property 17)
    - **Property 17: Implementation State Schema Validity**
    - Create `backend/src/agent-config/__tests__/state-schema.pbt.spec.ts`
    - For any module entry, verify all required fields present with valid values
    - Minimum 100 iterations
    - **Validates: Requirements 9.2, 9.5**

- [x] 12. Final checkpoint - Ensure all tests pass
  - Run `npm run test -- --testPathPattern=agent-config` from the backend directory. Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All configuration files are additive — no existing files are modified
- Rule files are created first because skills reference validation rules
- Skills are created in pipeline order (extract → store → generate → send) to validate data flow
- Steering file is created after skills since it references all skill names
- Implementation state is created last as it documents the current system

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["3.1", "3.2", "3.3", "3.4"] },
    { "id": 2, "tasks": ["5.1", "6.1"] },
    { "id": 3, "tasks": ["8.1"] },
    { "id": 4, "tasks": ["8.2", "8.3", "8.4", "8.5", "8.6"] },
    { "id": 5, "tasks": ["9.1", "9.2", "9.3", "9.4"] },
    { "id": 6, "tasks": ["10.1", "10.2", "10.3"] },
    { "id": 7, "tasks": ["11.1", "11.2", "11.3", "11.4", "11.5"] }
  ]
}
```
