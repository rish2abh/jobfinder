# Implementation Plan: JobFinder AI System

## Overview

This plan implements the four major new modules (Auth, Matching, Auto-Apply, Bulk Contact) and enhancements to existing modules. Tasks are ordered by dependency: Auth first (all endpoints require it), then Matching, then Auto-Apply, then Bulk Contact, then enhancements. Each task builds incrementally on prior work, with no orphaned code.

## Tasks

- [x] 1. Install dependencies and set up project infrastructure
  - [x] 1.1 Install backend dependencies
    - Run `npm install @nestjs/jwt @nestjs/passport passport passport-jwt bcrypt chromadb csv-parser mammoth fast-check` in the backend directory
    - Run `npm install -D @types/passport-jwt @types/bcrypt` for type definitions
    - _Requirements: 11.1, 12.1, 7.1_

  - [x] 1.2 Install frontend testing dependencies
    - Run `npm install -D vitest fast-check @testing-library/react @testing-library/jest-dom jsdom` in the frontend directory
    - Configure vitest in `vite.config.ts` with jsdom environment
    - _Requirements: Testing strategy from design_

- [x] 2. Implement JWT Authentication Module
  - [x] 2.1 Extend User schema with auth fields
    - Add `password` (string, optional), `refreshTokens` (array of RefreshTokenEntry), `failedLoginAttempts` (number, default 0), `accountLockedUntil` (Date, optional) fields to `backend/src/users/user.schema.ts`
    - Update `UsersRepository` with methods: `findByEmail`, `updatePassword`, `addRefreshToken`, `removeRefreshToken`, `incrementFailedAttempts`, `resetFailedAttempts`, `lockAccount`
    - _Requirements: 11.1, 11.3_

  - [x] 2.2 Create Auth module core files
    - Create `backend/src/auth/auth.module.ts` — Register JwtModule with 15min expiry, PassportModule, import UsersModule
    - Create `backend/src/auth/public.decorator.ts` — `@Public()` decorator using `SetMetadata`
    - Create `backend/src/auth/dto/register.dto.ts` — name (2-100 chars), email (valid format), password (8-128 chars)
    - Create `backend/src/auth/dto/login.dto.ts` — email, password
    - Create `backend/src/auth/dto/refresh-token.dto.ts` — refreshToken string
    - _Requirements: 11.1, 11.2_

  - [x] 2.3 Implement AuthService with token logic
    - Create `backend/src/auth/auth.service.ts` with methods:
      - `register(dto)` — hash password with bcrypt (cost 10), create user via UsersService
      - `login(dto)` — validate credentials, check lockout, issue access + refresh tokens
      - `refresh(token)` — verify refresh token, rotate (revoke old, issue new pair)
      - `logout(userId, token)` — revoke specific refresh token
      - `validateUser(payload)` — extract user from JWT payload
    - Implement account lockout: 5 failed attempts → lock for 15 minutes
    - Refresh token stored as bcrypt hash in user document, 7-day expiry
    - _Requirements: 11.1, 11.2, 11.3, 11.6, 11.7, 11.11_

  - [x] 2.4 Implement JWT Strategy and Auth Guard
    - Create `backend/src/auth/jwt.strategy.ts` — Passport JWT strategy extracting Bearer token from Authorization header, validate payload against DB
    - Create `backend/src/auth/jwt-auth.guard.ts` — Global guard that skips routes decorated with `@Public()`
    - Register guard as `APP_GUARD` in AuthModule providers
    - _Requirements: 11.4, 11.5, 11.10_

  - [x] 2.5 Implement AuthController endpoints
    - Create `backend/src/auth/auth.controller.ts` with:
      - `POST /auth/register` — @Public(), validate DTO, call authService.register
      - `POST /auth/login` — @Public(), validate DTO, call authService.login, set refresh token in httpOnly cookie
      - `POST /auth/refresh` — @Public(), read refresh token from cookie, call authService.refresh
      - `POST /auth/logout` — Protected, revoke refresh token
      - `GET /auth/me` — Protected, return current user from request
    - Add Swagger decorators to all endpoints
    - _Requirements: 11.2, 11.6, 11.7, 11.11_

  - [x] 2.6 Add JWT guards to all existing controllers
    - Add `@Public()` decorator to existing registration/health endpoints
    - Ensure all `UsersController`, `FileUploadController`, `JobsController`, `MailController` endpoints are protected by default (global guard handles this)
    - Add `@Request() req` parameter to controllers that need `req.user.sub` (userId) for data isolation
    - Update existing controller methods to use `req.user.sub` instead of accepting userId as a path/body parameter where appropriate
    - _Requirements: 11.10_

  - [ ]* 2.7 Write property test for JWT token round-trip (Property 16)
    - **Property 16: JWT token round-trip**
    - For any valid user payload (userId, email), signing and verifying SHALL extract the same values; expired/malformed tokens SHALL reject
    - Use `fast-check` with `fc.record({ sub: fc.uuid(), email: fc.emailAddress() })`
    - **Validates: Requirements 11.2, 11.4, 11.5**

  - [ ]* 2.8 Write property test for input validation (Property 1)
    - **Property 1: Input validation correctness**
    - Name validator accepts strings of length 2-100 only; email validator accepts valid email patterns only
    - Use `fast-check` with `fc.string()` for name, `fc.emailAddress()` and `fc.string()` for email
    - **Validates: Requirements 1.3**

  - [ ]* 2.9 Write unit tests for Auth module
    - Test registration with valid/invalid inputs
    - Test login with correct/incorrect credentials
    - Test account lockout after 5 failed attempts
    - Test refresh token rotation and revocation
    - Test expired token rejection
    - _Requirements: 11.1, 11.2, 11.3, 11.5, 11.6, 11.7_

- [x] 3. Checkpoint - Auth Module
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement AI-Powered Job-Resume Matching Module
  - [x] 4.1 Create MatchScore schema and repository
    - Create `backend/src/matching/match-score.schema.ts` with fields: userId, jobId, cosineSimilarity, skillOverlap, finalScore, degraded, computedAt
    - Create compound unique index on `{ userId, jobId }` and sort index on `{ userId, finalScore: -1 }`
    - Create `backend/src/matching/match-score.repository.ts` with CRUD + bulk upsert + invalidation methods
    - _Requirements: 12.3, 12.10_

  - [x] 4.2 Implement score calculator (pure function)
    - Create `backend/src/matching/score-calculator.ts` with `computeMatchScore(cosineSimilarity, resumeSkills, jobKeywords)` function
    - Implements: finalScore = round((0.7 * cosine + 0.3 * skillOverlap) * 100), clamped [0, 100]
    - Skill overlap = case-insensitive exact match count / total resume skills (0 if no skills)
    - _Requirements: 12.4_

  - [ ]* 4.3 Write property test for Match_Score computation (Property 17)
    - **Property 17: Match_Score computation**
    - For any cosine in [0,1] and any skill arrays, score equals round((0.7*cosine + 0.3*overlap)*100) clamped to [0,100]
    - Use `fc.float({ min: 0, max: 1, noNaN: true })` and `fc.array(fc.string())`
    - **Validates: Requirements 12.4**

  - [ ]* 4.4 Write property test for Match_Score ranking (Property 18)
    - **Property 18: Match_Score ranking**
    - For any set of scores, ranking descending produces a non-increasing sequence
    - Use `fc.array(fc.nat({ max: 100 }))`
    - **Validates: Requirements 12.5**

  - [x] 4.5 Implement embedding service (ChromaDB + Ollama)
    - Create `backend/src/matching/embedding.service.ts` with methods:
      - `generateEmbedding(text)` — call Ollama `/api/embeddings` endpoint, return float array
      - `upsertProfileEmbedding(userId, text, metadata)` — store in ChromaDB `profiles` collection
      - `upsertJobEmbeddings(jobs[])` — batch store in ChromaDB `jobs` collection
      - `querySimilarity(userId, jobIds)` — retrieve cosine similarities
      - `deleteProfileEmbedding(userId)` — remove on re-embed
    - Retry Ollama 3x with 5s delay on failure; fallback flag if all fail
    - _Requirements: 12.1, 12.2, 12.6, 12.7_

  - [ ]* 4.6 Write property test for embedding batch sizing (Property 19)
    - **Property 19: Embedding batch sizing**
    - For any N jobs, batches of max 50 items with ceil(N/50) batches totaling N items
    - Use `fc.nat({ max: 500 })`
    - **Validates: Requirements 12.12**

  - [x] 4.7 Implement matching processor (BullMQ)
    - Create `backend/src/matching/matching.processor.ts` — BullMQ processor for `matching` queue
    - Handle job types: `embed-profile` (single user), `embed-jobs` (batch of job IDs), `compute-scores` (user + jobs)
    - Batch jobs into groups of max 50 for embedding
    - On profile update: regenerate embedding, invalidate cached scores, recompute
    - _Requirements: 12.1, 12.2, 12.9, 12.12_

  - [x] 4.8 Implement matching service and controller
    - Create `backend/src/matching/matching.service.ts` with:
      - `getScores(userId, pagination)` — return cached scores or trigger compute
      - `recompute(userId)` — force recompute all scores
      - `onProfileUpdate(userId)` — invalidate + re-embed + recompute
      - `onNewJobsScraped(userId, jobIds)` — embed new jobs + compute scores
    - Create `backend/src/matching/matching.controller.ts` with endpoints:
      - `GET /matching/scores/:userId` — get cached scores (paginated, sorted by score desc)
      - `POST /matching/recompute/:userId` — trigger recompute job
      - `GET /matching/status/:jobId` — poll matching job status
    - _Requirements: 12.3, 12.5, 12.9, 12.10_

  - [x] 4.9 Create Matching Module and wire integrations
    - Create `backend/src/matching/matching.module.ts` — register all services, import BullModule for `matching` queue, MongooseModule for MatchScore
    - Hook into resume-parse completion: emit event/call matching service to embed profile
    - Hook into job-scrape completion: emit event/call matching service to embed new jobs
    - Import MatchingModule in AppModule
    - _Requirements: 12.1, 12.2, 12.9_

  - [ ]* 4.10 Write unit tests for matching module
    - Test score calculator with edge cases (0 skills, all matching, no matching, cosine = 0/1)
    - Test ChromaDB fallback to keyword-only matching
    - Test score invalidation on profile update
    - Test batch splitting logic
    - _Requirements: 12.4, 12.6, 12.9, 12.12_

- [x] 5. Checkpoint - Matching Module
  - All tests pass (75/75), build compiles cleanly. Matching module fully wired with integrations.

- [x] 6. Implement Automated Job Application Module
  - [x] 6.1 Create Application schema and repository
    - Create `backend/src/auto-apply/application.schema.ts` with fields: userId, jobId, status (enum), platform, appliedAt, failureReason, skippedFields, createdAt, updatedAt
    - Add indexes: `{ userId, status }`, `{ userId, createdAt: -1 }`
    - Create `backend/src/auto-apply/application.repository.ts` with CRUD + stats methods
    - _Requirements: 13.5, 13.9_

  - [x] 6.2 Implement form filler and confirmation detector
    - Create `backend/src/auto-apply/form-filler.ts`:
      - Detect form fields by label text, input name, placeholder attributes (case-insensitive)
      - Map fields to profile data using FIELD_MAPPINGS dictionary
      - Handle resume file upload field via Playwright `setInputFiles`
      - Return list of skipped fields that couldn't be mapped
    - Create `backend/src/auto-apply/confirmation-detector.ts`:
      - Detect URL change to thank-you/confirmation path
      - Detect success message elements on page
      - 60-second timeout for confirmation detection
    - _Requirements: 13.2, 13.3, 13.5, 13.13_

  - [ ]* 6.3 Write property test for form field mapping (Property 20)
    - **Property 20: Form field mapping**
    - For any field with label/name/placeholder matching a known keyword, mapper returns correct profile field; unmatched fields get "requires manual review"
    - Use `fc.oneof(fc.constantFrom(...knownLabels), fc.string())` for field descriptors
    - **Validates: Requirements 13.2**

  - [x] 6.4 Implement auto-apply processor (BullMQ + Playwright)
    - Create `backend/src/auto-apply/auto-apply.processor.ts` — BullMQ processor for `auto-apply` queue
    - Launch headless browser (reuse `launchBrowser()` pattern from scraper)
    - Navigate to applyUrl (30s timeout), detect CAPTCHA/login walls (abort within 10s)
    - Auto-fill form fields using form-filler, submit form, detect confirmation
    - Record result in Application collection
    - Retry browser launch once (5s delay) on failure
    - Report progress: current job index / total jobs
    - _Requirements: 13.1, 13.2, 13.4, 13.5, 13.6, 13.8, 13.10_

  - [x] 6.5 Implement auto-apply service and controller
    - Create `backend/src/auto-apply/auto-apply.service.ts`:
      - `applySingle(userId, jobId)` — validate job has applyUrl, enqueue single job
      - `applyBatch(userId, jobIds[])` — validate max 50, enqueue sequential processing
      - `getApplications(userId, filters)` — list tracked applications
      - `getStats(userId)` — count by status
      - Rate limiting check: max 10/hr per platform via BullMQ limiter
    - Create `backend/src/auto-apply/auto-apply.controller.ts`:
      - `POST /applications/apply` — single apply
      - `POST /applications/batch-apply` — batch (max 50 jobs)
      - `GET /applications/status/:jobId` — poll status
      - `GET /applications/:userId` — list applications
      - `GET /applications/:userId/stats` — statistics
    - Create DTOs: `trigger-apply.dto.ts`, `batch-apply.dto.ts`
    - _Requirements: 13.6, 13.7, 13.8, 13.9, 13.11, 13.12_

  - [x] 6.6 Create Auto-Apply Module and register
    - Create `backend/src/auto-apply/auto-apply.module.ts` — register services, import BullModule for `auto-apply` queue (concurrency 1, rate limit 10/hr), MongooseModule for Application schema
    - Import in AppModule
    - _Requirements: 13.6, 13.11_

  - [ ]* 6.7 Write property test for rate limiting (Property 21)
    - **Property 21: Rate limiting enforcement**
    - For any sequence of apply requests to same platform, at most 10 processed per 60-minute window; excess queued not dropped
    - Use `fc.array(fc.record({ timestamp: fc.nat(), platform: fc.constantFrom('indeed','naukri','internshala') }))`
    - **Validates: Requirements 13.11**

  - [ ]* 6.8 Write unit tests for auto-apply module
    - Test form field detection with various HTML attributes
    - Test CAPTCHA/login wall detection abort
    - Test confirmation detection (URL change, success message)
    - Test batch validation (max 50, no applyUrl rejection)
    - Test browser launch retry logic
    - _Requirements: 13.1, 13.2, 13.4, 13.5, 13.10, 13.12_

- [x] 7. Checkpoint - Auto-Apply Module
  - All tests pass (75/75), build compiles cleanly. Auto-apply module fully implemented with schema, repository, form filler, confirmation detector, BullMQ processor, service, controller, and registered in AppModule.

- [x] 8. Implement Bulk Contact Upload and AI Email Module
  - [x] 8.1 Create Bulk Contact schemas
    - Create `backend/src/bulk-contact/bulk-contact.schema.ts` — userId, name, email, title, company, sourceFile, uploadedAt; index `{ userId, email }` unique
    - Create `backend/src/bulk-contact/contact-group.schema.ts` — userId, groupType, groupValue, contactIds, templateId, createdAt; index `{ userId, groupType, groupValue }`
    - Create `backend/src/bulk-contact/email-template.schema.ts` — groupId, userId, subject (max 200), body (max 2000), generatedBy, cachedAt; index `{ groupId }` unique
    - Create `backend/src/mail/mail-result.schema.ts` — userId, bulkJobId, groupId, recipientEmail, recipientName, status, failureReason, sentAt
    - _Requirements: 7.1_

  - [x] 8.2 Implement contact parser service
    - Create `backend/src/bulk-contact/contact-parser.service.ts`:
      - `parseCSV(buffer)` — use `csv-parser` to extract name, email, title, company columns
      - `parsePDF(buffer)` — use `pdf-parse` + regex/LLM to extract structured contacts
      - `parseDOCX(buffer)` — use `mammoth` to convert to text, then parse structured contacts
      - Validate each record: skip if missing name or email, report skipped in validation errors
      - Reject files >10MB or unsupported formats with 400 error
    - _Requirements: 7.1 (File Upload and Parsing)_

  - [ ]* 8.3 Write property test for CSV parsing round-trip (Property 9)
    - **Property 9: Contact file parsing round-trip (CSV)**
    - For any valid CSV with name/email/title/company, parsing produces records matching original data (trimmed)
    - Use `fc.array(fc.record({ name: fc.string(), email: fc.emailAddress(), title: fc.string(), company: fc.string() }))`
    - **Validates: Requirements 7.1**

  - [ ]* 8.4 Write property test for contact sanitization (Property 10)
    - **Property 10: Contact list sanitization**
    - Sanitization excludes missing name/email, invalid emails, and duplicates (keeping first occurrence); result has no duplicates or invalid entries
    - Use `fc.array(fc.record({ name: fc.option(fc.string()), email: fc.option(fc.oneof(fc.emailAddress(), fc.string())) }))`
    - **Validates: Requirements 7.1**

  - [x] 8.5 Implement grouping service
    - Create `backend/src/bulk-contact/grouping.service.ts`:
      - `groupByTitle(contacts)` — group contacts by title field value
      - `groupByCompany(contacts)` — group contacts by company field value
      - Store group metadata in ContactGroups collection
      - Ensure union of all groups equals complete contact list (no loss/duplication)
    - _Requirements: 7.1 (Grouping Logic)_

  - [ ]* 8.6 Write property test for contact grouping (Property 11)
    - **Property 11: Contact grouping correctness**
    - For any contact list and group mode, every contact in a group has same grouping field value; union of groups equals full list
    - Use `fc.array(fc.record({ title: fc.string(), company: fc.string() }))` with `fc.constantFrom('title','company')`
    - **Validates: Requirements 7.1**

  - [x] 8.7 Implement template generator and personalization services
    - Create `backend/src/bulk-contact/template-generator.service.ts`:
      - `generateTemplate(groupType, groupValue, userProfile, userPrompt?)` — call Ollama to generate subject (max 200 chars) + body (max 2000 chars)
      - Cache template per group in EmailTemplates collection
      - Return cached template if already generated for group
      - Fallback: if Ollama fails, allow manual template input
    - Create `backend/src/bulk-contact/personalization.service.ts`:
      - `personalizeTemplate(template, recipient)` — replace `{{name}}`, `{{company}}`, `{{title}}` with actual values
    - _Requirements: 7.1 (AI Template Generation, Dynamic Personalization)_

  - [ ]* 8.8 Write property test for template personalization (Property 12)
    - **Property 12: Template personalization replaces all placeholders**
    - For any template with placeholders and recipient with non-empty values, output has zero remaining placeholders and contains actual values
    - Use `fc.record({ subject: fc.string(), body: fc.string() })` mixed with placeholder tokens
    - **Validates: Requirements 7.1**

  - [x] 8.9 Implement bulk contact controller and service
    - Create `backend/src/bulk-contact/bulk-contact.service.ts` — orchestration: upload → parse → store → group → generate templates → trigger send
    - Create `backend/src/bulk-contact/bulk-contact.controller.ts`:
      - `POST /contacts/upload` — upload file, parse, store contacts, return validation report
      - `POST /contacts/group` — group contacts by title or company
      - `GET /contacts/groups/:userId` — get grouped contacts
      - `POST /contacts/generate-templates` — generate AI templates per group
      - `PATCH /contacts/templates/:groupId` — edit template before send
      - `POST /contacts/send` — trigger bulk send (enqueue mail jobs with rate limit 5/min)
      - `GET /contacts/send/status/:jobId` — poll send status
    - Create DTOs for each endpoint
    - _Requirements: 7.1_

  - [x] 8.10 Extend mail processor for rate-limited template sending
    - Update `backend/src/mail/mail.processor.ts` to handle template-based emails with personalization
    - Configure BullMQ `bulk-mail` queue limiter: `{ max: 5, duration: 60000 }` (5 per minute)
    - Store per-recipient results in MailResults collection
    - Attach resume (base or customized) from Cloudinary URL
    - _Requirements: 7.1 (Bulk Sending, Rate Limiting, Result Tracking)_

  - [ ]* 8.11 Write property test for bulk send result aggregation (Property 13)
    - **Property 13: Bulk send result aggregation**
    - For any array of sent/failed outcomes: total = successCount + failedCount; counts match respective outcomes
    - Use `fc.array(fc.constantFrom('sent', 'failed'))`
    - **Validates: Requirements 7.1**

  - [x] 8.12 Create Bulk Contact Module and register
    - Create `backend/src/bulk-contact/bulk-contact.module.ts` — register all services, import MongooseModule for all 3 schemas, import MailModule, import BullModule
    - Import BulkContactModule in AppModule
    - _Requirements: 7.1_

  - [ ]* 8.13 Write unit tests for bulk contact module
    - Test CSV/PDF/DOCX parsing with valid and malformed inputs
    - Test grouping with edge cases (empty title/company, single-group, many-group)
    - Test personalization with missing optional fields (company, title as empty)
    - Test deduplication of emails before send
    - Test rate limiting configuration
    - _Requirements: 7.1_

- [x] 9. Checkpoint - Bulk Contact Module
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implement Frontend Auth and Protected Routes
  - [x] 10.1 Implement login and registration pages
    - Create `frontend/src/pages/auth/LoginPage.tsx` — email + password form, call `/auth/login`, store access token in memory, handle errors
    - Update `frontend/src/pages/auth/SignupPage.tsx` — add password field (8-128 chars), call `/auth/register`
    - Create `frontend/src/pages/auth/AuthLayout.tsx` — shared layout for auth pages
    - _Requirements: 11.2, 11.8_

  - [x] 10.2 Implement auth state management and interceptors
    - Update Zustand store (`useUserStore` or create `useAuthStore`) to hold accessToken in memory (not localStorage)
    - Configure Axios interceptor to attach Bearer token to all requests
    - Configure Axios response interceptor: on 401, attempt refresh via `/auth/refresh` (cookie-based), retry original request; on refresh failure, redirect to login
    - Set `withCredentials: true` on Axios for httpOnly cookie support
    - _Requirements: 11.8, 11.9_

  - [x] 10.3 Implement protected route wrapper and navigation updates
    - Create `frontend/src/components/ProtectedRoute.tsx` — redirect to /auth/login if no token
    - Wrap all dashboard routes with ProtectedRoute
    - Update sidebar navigation to show logout button
    - Add `/auth/login` and `/auth/register` routes to router
    - _Requirements: 11.8, 11.9, 11.10_

- [x] 11. Implement Frontend Matching UI
  - [x] 11.1 Add match score display to job listings
    - Update `frontend/src/pages/JobListings.tsx` to fetch match scores from `/matching/scores/:userId`
    - Display Match_Score as a percentage badge on each job card (color-coded: green >70, yellow 40-70, red <40)
    - Add "Sort by Match Score" option to sort controls
    - Show "degraded" indicator if score was computed without vector similarity
    - _Requirements: 12.3, 12.5, 12.11_

  - [x] 11.2 Create matching scores dashboard page
    - Create `frontend/src/pages/MatchingPage.tsx` — show top-matched jobs with scores
    - Add "Recompute Scores" button that triggers `/matching/recompute/:userId`
    - Show loading/progress state during recomputation
    - Add route `/dashboard/matching` and sidebar navigation link
    - _Requirements: 12.3, 12.9, 12.11_

- [x] 12. Implement Frontend Applications Page
  - [x] 12.1 Create applications tracking page
    - Create `frontend/src/pages/ApplicationsPage.tsx`:
      - Fetch applications from `GET /applications/:userId`
      - Display table/cards with: job title, company, status badge (applied/failed/requires manual action/pending), timestamp
      - Filter by status
      - Show skipped fields for "requires manual action" entries
    - Add "Auto Apply" button on job listing cards (calls `POST /applications/apply`)
    - Add "Batch Apply" action for selected jobs (calls `POST /applications/batch-apply`)
    - Add route `/dashboard/applications` and sidebar navigation link
    - _Requirements: 13.7, 13.8, 13.9_

- [x] 13. Implement Frontend Bulk Contact UI
  - [x] 13.1 Create bulk contact management page
    - Create `frontend/src/pages/ContactsPage.tsx`:
      - File upload component accepting PDF/DOC/DOCX/CSV (max 10MB)
      - Display parsed contacts with validation error report
      - Grouping selector (by Title or Company)
      - Group preview UI showing contacts per group
      - "Generate Templates" button per group
      - Template preview/edit form (subject + body) per group
      - Approval step showing summary before sending
      - "Send All" trigger button
      - Status polling for bulk send job
    - Add route `/dashboard/contacts` and sidebar navigation link
    - _Requirements: 7.1 (Frontend Requirements)_

- [x] 14. Checkpoint - Frontend Implementation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Implement Enhancements (Logging, Filtering, Monitoring)
  - [x] 15.1 Enhance structured logging for background jobs
    - Update all BullMQ processors (resume-parse, job-scrape, bulk-mail, matching, auto-apply) to log lifecycle events at info level: job enqueued, started, progress, completed (with duration ms), failed (with error + stack trace)
    - Include job ID, user ID, queue name in every log entry
    - _Requirements: 10.3, 10.6_

  - [x] 15.2 Add external service interaction logging
    - Add logging to Cloudinary calls, Ollama calls, SMTP sends, ChromaDB operations, scraper HTTP calls
    - Log: service name, operation, response time (ms), HTTP status at info level
    - On failure: log at error level with service name, operation, elapsed time, error message, stack trace
    - _Requirements: 10.4, 10.5_

  - [x] 15.3 Write property test for log entry structure (Property 15)
    - **Property 15: Log entry structure**
    - For any log call with message and context, output contains ISO 8601 timestamp, level, context label, and message
    - Use `fc.record({ message: fc.string(), context: fc.string(), level: fc.constantFrom('error','warn','info','verbose','debug') })`
    - **Validates: Requirements 10.2**

  - [x] 15.4 Implement custom keyword filtering (title + description)
    - Update `backend/src/jobs/jobs.repository.ts` query logic to support keyword filtering that matches against both `title` AND `jd` (job description) fields using case-insensitive regex
    - Update `backend/src/jobs/dto/trigger-scrape.dto.ts` or query DTO to accept keyword filter param
    - Update frontend filter controls to include keyword text input that triggers description search
    - _Requirements: 6.2_

  - [x] 15.5 Write property test for job query correctness (Property 8)
    - **Property 8: Job query correctness**
    - For any jobs and valid query params (page 1-200, filters, sort), results have at most pageSize items, match all filters, and are sorted correctly
    - Use `fc.array(fc.record(...))` for jobs, `fc.record(...)` for query params
    - **Validates: Requirements 6.1, 6.2, 6.4**

  - [x] 15.6 Implement unified job monitoring dashboard
    - Create `backend/src/jobs/job-monitor.controller.ts` (or extend existing controller):
      - `GET /jobs/monitor/active` — return all active jobs across all 5 queues with type, state, progress
    - Update frontend to add a "Background Jobs" section in Dashboard:
      - Show all active/recent jobs grouped by type (resume-parse, job-scrape, bulk-mail, matching, auto-apply)
      - Show state, progress bar, failure reason
      - Add "Retry" button for failed resume-parse and job-scrape jobs
      - For failed bulk-mail: show failed recipients list, no auto-retry
    - _Requirements: 9.1, 9.4, 9.5, 9.6_

- [x] 16. Implement Remaining Property Tests and Wiring
  - [x] 16.1 Write property test for file upload validation (Property 2)
    - **Property 2: File upload validation**
    - For any file, reject if not PDF or >10MB; accept valid PDFs ≤10MB
    - Use `fc.record({ size: fc.nat({ max: 20_000_000 }), mimetype: fc.oneof(fc.constant('application/pdf'), fc.string()) })`
    - **Validates: Requirements 2.3**

  - [ ]* 16.2 Write property test for resume text truncation (Property 3)
    - **Property 3: Resume text truncation**
    - For any string, enqueue passes at most 6000 chars; if input ≤6000, output equals input
    - Use `fc.string({ maxLength: 20000 })`
    - **Validates: Requirements 3.1**

  - [ ]* 16.3 Write property test for partial profile update (Property 4)
    - **Property 4: Partial profile update preserves unmodified fields**
    - For any profile and any field subset, result has new values for submitted fields and original for others
    - Use `fc.record(...)` with `fc.subarray(...)` for field selection
    - **Validates: Requirements 4.3, 4.4**

  - [ ]* 16.4 Write property test for resume re-parse preservation (Property 5)
    - **Property 5: Resume re-parse preserves manually edited fields**
    - For any profile with mixed lastUpdatedFrom values, re-parse only updates non-manual fields
    - Use `fc.record(...)` with `fc.constantFrom('manual', 'resume', 'auto')` for lastUpdatedFrom
    - **Validates: Requirements 4.6**

  - [ ]* 16.5 Write property test for deduplication hash (Property 6)
    - **Property 6: Deduplication hash determinism and case-insensitivity**
    - For any title/company pair, hash is deterministic and case-insensitive (same hash for case variants)
    - Use `fc.tuple(fc.string(), fc.string())`
    - **Validates: Requirements 5.4**

  - [ ]* 16.6 Write property test for relative date parsing (Property 7)
    - **Property 7: Relative date string parsing**
    - For "N unit ago" strings, result is within ±1min of now - N*unit; unparseable returns undefined
    - Use `fc.record({ n: fc.nat({ max: 365 }), unit: fc.constantFrom('minutes','hours','days','weeks','months') })`
    - **Validates: Requirements 5.7**

  - [ ]* 16.7 Write property test for cache cleanup (Property 14)
    - **Property 14: Cache cleanup by age threshold**
    - For any jobs with timestamps and days param (1-365), cleanup deletes exactly those older than threshold
    - Use `fc.array(fc.record({ scrapedAt: fc.date() }))` and `fc.nat({ min: 1, max: 365 })`
    - **Validates: Requirements 8.4**

- [x] 17. Final Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout (NestJS backend + React/Vite frontend)
- All new modules follow existing patterns: DI injection, repository pattern, Swagger decorators, BullMQ queue registration
- Frontend follows existing patterns: React Query hooks, Zustand stores, TailwindCSS, toast notifications
- Existing code in the "Do Not Modify" section must not be changed — only extended

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3"] },
    { "id": 3, "tasks": ["2.4"] },
    { "id": 4, "tasks": ["2.5"] },
    { "id": 5, "tasks": ["2.6", "2.7", "2.8"] },
    { "id": 6, "tasks": ["2.9"] },
    { "id": 7, "tasks": ["4.1", "4.2"] },
    { "id": 8, "tasks": ["4.3", "4.4", "4.5"] },
    { "id": 9, "tasks": ["4.6", "4.7"] },
    { "id": 10, "tasks": ["4.8"] },
    { "id": 11, "tasks": ["4.9", "4.10"] },
    { "id": 12, "tasks": ["6.1", "6.2"] },
    { "id": 13, "tasks": ["6.3", "6.4"] },
    { "id": 14, "tasks": ["6.5"] },
    { "id": 15, "tasks": ["6.6", "6.7", "6.8"] },
    { "id": 16, "tasks": ["8.1"] },
    { "id": 17, "tasks": ["8.2", "8.5"] },
    { "id": 18, "tasks": ["8.3", "8.4", "8.6", "8.7"] },
    { "id": 19, "tasks": ["8.8", "8.9"] },
    { "id": 20, "tasks": ["8.10"] },
    { "id": 21, "tasks": ["8.11", "8.12"] },
    { "id": 22, "tasks": ["8.13"] },
    { "id": 23, "tasks": ["10.1", "10.2"] },
    { "id": 24, "tasks": ["10.3"] },
    { "id": 25, "tasks": ["11.1", "11.2", "12.1", "13.1"] },
    { "id": 26, "tasks": ["15.1", "15.2"] },
    { "id": 27, "tasks": ["15.3", "15.4"] },
    { "id": 28, "tasks": ["15.5", "15.6"] },
    { "id": 29, "tasks": ["16.1", "16.2", "16.3", "16.4", "16.5", "16.6", "16.7"] }
  ]
}
```
