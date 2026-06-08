## ⚠️ Agent Execution Instructions

Before implementing any feature:

1. Refer to implementation-state.md
2. Identify what is already implemented
3. Extend existing modules (do not rebuild)
4. Follow rules defined in .kiro/rules

Constraints:
- Do not scan full repository
- Do not rewrite full files
- Only modify relevant modules


# Requirements Document

## Introduction

The JobFinder AI System is an end-to-end intelligent job search and application platform. It combines resume parsing via LLM (Ollama/Mistral), multi-source job scraping, AI-powered job-resume matching, automated email generation with recruiter outreach, and application tracking. The system consists of a NestJS backend with modular architecture, a React (Vite) frontend with TailwindCSS, MongoDB for persistence, Redis/BullMQ for async job processing, and Chromium-based automation via Playwright.

## Glossary

- **Backend**: The NestJS server application providing REST APIs and background job processing
- **Frontend**: The React single-page application built with Vite and TailwindCSS
- **Resume_Parser**: The subsystem that extracts structured data from uploaded PDF resumes using Ollama LLM
- **Job_Scraper**: The subsystem that fetches job listings from multiple external sources (Indeed, Naukri, Internshala, Google Jobs, JSearch)
- **Matching_Engine**: The subsystem that computes job-resume compatibility scores using RAG (Retrieval-Augmented Generation) with ChromaDB vector similarity
- **Email_Generator**: The subsystem that generates personalized outreach emails using AI and sends them via SMTP
- **Auto_Applier**: The subsystem that automates job applications via Playwright browser automation
- **Auth_Module**: The subsystem that handles user authentication using JWT access and refresh tokens
- **Application_Tracker**: The subsystem that tracks job application statuses and history
- **User**: A job seeker using the platform
- **Job_Listing**: A scraped job posting stored in MongoDB with title, company, description, source, and metadata
- **Profile**: Structured user data (skills, experience, education, projects) derived from resume parsing
- **BullMQ_Queue**: The Redis-backed async job processing system for long-running tasks
- **Cloudinary**: Cloud storage service used for hosting uploaded resume PDFs
- **Ollama**: Local LLM inference server used for resume parsing and email generation
- **ChromaDB**: Vector database used for storing resume and job description embeddings for similarity search
- **Match_Score**: A numerical score (0-100) indicating how well a job listing matches the user's profile based on vector similarity

## Requirements

### Requirement 1: User Registration and Onboarding

**User Story:** As a job seeker, I want to create an account and onboard quickly, so that I can start using the platform to find jobs.

#### Acceptance Criteria

1. WHEN a user submits a valid name and email, THE Backend SHALL create a new user record in MongoDB and return the user ID
2. IF a user attempts to register with an email that already exists, THEN THE Backend SHALL return an error response indicating the email is already associated with an existing account
3. THE Frontend SHALL provide a signup form that validates name (minimum 2 characters, maximum 100 characters) and email (matching the pattern `local@domain.tld` with no whitespace) before submission, and SHALL display an inline error message beneath each invalid field
4. WHEN the Backend returns a successful registration response, THE Frontend SHALL store the returned user ID and redirect the user to the dashboard
5. IF the registration request fails due to a duplicate email, THEN THE Frontend SHALL display a notification indicating the email is already registered and switch to the sign-in view
6. IF the registration request fails due to a network or server error (non-duplicate), THEN THE Frontend SHALL display an error notification and preserve the user's form input

### Requirement 2: Resume Upload and PDF Storage

**User Story:** As a job seeker, I want to upload my resume as a PDF, so that the system can extract my professional information.

#### Acceptance Criteria

1. WHEN a user uploads a valid PDF file, THE Backend SHALL upload the file to Cloudinary and return a response containing the secure URL and a job identifier within 10 seconds
2. WHEN a PDF is uploaded, THE Backend SHALL extract raw text from the PDF using pdf-parse within 5 seconds
3. IF the uploaded file is not a valid PDF or exceeds 10MB in size, THEN THE Backend SHALL reject the request with a 400 error and a message indicating the validation failure reason (invalid file type or size exceeded)
4. IF Cloudinary upload fails, THEN THE Backend SHALL return a 500 error and log the failure details including the user identifier and error cause
5. THE Frontend SHALL provide a drag-and-drop upload area that accepts only PDF files up to 10MB and visually indicates the accepted format and size constraint to the user
6. WHEN an upload is in progress, THE Frontend SHALL display a progress indicator showing the upload percentage (0–100%)
7. IF text extraction produces an empty result (zero extractable characters), THEN THE Backend SHALL return a response indicating that no text could be extracted from the PDF

### Requirement 3: AI-Powered Resume Parsing

**User Story:** As a job seeker, I want my resume to be automatically parsed into structured data, so that the system understands my skills and experience.

#### Acceptance Criteria

1. WHEN raw text is extracted from a resume, THE Resume_Parser SHALL enqueue an LLM parsing job on the BullMQ_Queue with the raw text (truncated to a maximum of 6000 characters) and the associated user ID
2. WHEN the LLM job executes, THE Resume_Parser SHALL call Ollama with the raw text and extract structured JSON containing at minimum the fields: name, email, phone, location, summary, skills, experience, education, certifications, languages, and projects
3. WHEN parsing completes and the returned JSON contains at least one of the fields name, email, skills, or experience with a non-null value, THE Resume_Parser SHALL save the parsed JSON to the user's resume field and populate the profile field in MongoDB
4. IF the LLM returns invalid JSON or JSON missing all expected resume fields, THEN THE Resume_Parser SHALL retry the LLM call up to 2 additional times (3 total attempts), waiting at least 2 seconds multiplied by the attempt number between retries
5. IF the LLM call does not respond within 300 seconds, THEN THE Resume_Parser SHALL treat the attempt as failed and proceed to the next retry or mark the job as failed if no retries remain
6. WHILE a parse job is in progress, THE Backend SHALL report job progress as a numeric percentage (0-100) via a status polling endpoint, advancing to at least 10% when the LLM call begins and 80% when the LLM response is received
7. WHEN the LLM parse job fails after all 3 attempts, THE Resume_Parser SHALL mark the job as failed, store the error reason in the job metadata, and persist a fallback skeleton object containing null values for all expected fields and a parse-error indicator
8. WHEN a parse job is enqueued, THE Frontend SHALL poll the parse job status endpoint at an interval no faster than every 2 seconds and no slower than every 5 seconds, and display the current progress percentage to the user until the job reaches a completed or failed state
9. IF the LLM parse produces a fallback skeleton with a parse-error indicator, THEN THE Frontend SHALL display a warning to the user indicating that automatic parsing failed and manual profile editing is available

### Requirement 4: User Profile Management

**User Story:** As a job seeker, I want to view and edit my parsed profile, so that I can correct or enhance the information extracted from my resume.

#### Acceptance Criteria

1. THE Backend SHALL expose a GET endpoint that returns the user's full profile including name, email, phone, location, headline, bio, linkedin, github, website, skills (max 50 items), experience (max 20 entries), education (max 10 entries), certifications (max 15 items), languages (max 10 items), projects (max 20 entries), and a lastUpdatedFrom field indicating the source of the last update
2. IF the user has no parsed resume and no manually entered profile data, THEN THE Backend SHALL return an empty profile object with only the user's name and email populated
3. WHEN a user submits a profile update via the PATCH endpoint, THE Backend SHALL save only the provided fields, set the lastUpdatedFrom field to "manual", set the updatedAt timestamp to the current time, and return the updated user document within 2 seconds
4. IF a profile update contains an invalid email format or any string field exceeding 800 characters, THEN THE Backend SHALL return a validation error indicating which fields failed
5. THE Frontend SHALL display the user's profile in an editable form with distinct sections for contact info (phone, location, linkedin, github, website), professional summary (headline, bio), skills, experience, education, certifications, languages, and projects
6. WHEN a user re-uploads a resume, THE Resume_Parser SHALL update only those profile fields whose lastUpdatedFrom value is not "manual", preserving all fields that the user has previously edited and saved through the profile update endpoint

### Requirement 5: Multi-Source Job Scraping

**User Story:** As a job seeker, I want the system to scrape jobs from multiple platforms based on my skills, so that I have a comprehensive list of relevant opportunities.

#### Acceptance Criteria

1. WHEN a scrape is triggered, THE Job_Scraper SHALL enqueue a scrape job on the BullMQ_Queue with the user's skills, target sources, and optional filters (companies, keywords, country), configured with a maximum of 2 retry attempts and a fixed backoff delay of 5000 milliseconds between attempts
2. THE Job_Scraper SHALL support scraping from Indeed, Naukri, Internshala, Google Jobs, and JSearch API, collecting between 5 and 100 results per source (defaulting to 30 when not specified)
3. WHEN scraping from a source, THE Job_Scraper SHALL extract title, company, location, job description, apply URL, posted date, and contact email where available from each listing
4. THE Job_Scraper SHALL deduplicate jobs using a SHA-256 hash of the concatenation lowercase(title) + "|" + lowercase(company) before storing in MongoDB, rejecting entries whose hash matches an existing record
5. IF a scraping source returns a CAPTCHA or blocks access, THEN THE Job_Scraper SHALL flag the job entry with the block reason and continue processing remaining sources without aborting the scrape job
6. WHILE a scrape job is in progress, THE Backend SHALL report job progress via a status polling endpoint returning the current state (queued, active, completed, failed), a numeric progress percentage from 0 to 100, the result summary upon completion, and the failure reason if applicable
7. THE Job_Scraper SHALL parse relative posted-date strings (e.g., "2 days ago", "yesterday", "just posted") into ISO dates, and IF the posted-date string cannot be parsed, THEN THE Job_Scraper SHALL store the record with a null parsed date value
8. WHEN scraping completes, THE Job_Scraper SHALL store results in MongoDB with source attribution, matched skills, query keywords, and a scrape timestamp recording the completion time
9. IF the user has no skills provided in the request and no skills extracted from a parsed resume, THEN THE Job_Scraper SHALL return a response indicating no skills are available without enqueuing a scrape job

### Requirement 6: Job Listing Display and Filtering

**User Story:** As a job seeker, I want to browse scraped jobs with filtering and sorting options, so that I can find the most relevant opportunities.

#### Acceptance Criteria

1. THE Backend SHALL expose a paginated GET endpoint that returns jobs filtered by the user's skills, with a default page size of 50 results, a minimum of 1, and a maximum of 200 per request
2. THE Backend SHALL support filtering by source, experience level (internship, entry, mid, senior, manager), and custom keywords that match against both job title and job description fields
3. IF "auto" experience level is selected and the user's profile contains no work history entries, THEN THE Backend SHALL skip experience-level filtering and return jobs of all experience levels
4. THE Backend SHALL support sorting by posted date or scrape date, defaulting to posted date descending
5. THE Frontend SHALL display jobs in a list/card view showing title, company, location, source badge, and posted date
6. THE Frontend SHALL provide filter controls for source, experience level, keyword input, and sort order
7. WHEN a user clicks a job listing, THE Frontend SHALL display the full job description and, if an apply URL is available, provide a link to the apply URL
8. IF a job listing has no apply URL, THEN THE Frontend SHALL display the job description without an apply link and show an indication that no direct application link is available
9. IF no jobs match the applied filters, THEN THE Backend SHALL return an empty list with a total count of 0 and THE Frontend SHALL display a message indicating no jobs matched the current filters

Requirement 7.1: Bulk Contact Upload, Grouping, and Dynamic Email Personalization

User Story:
As a job seeker, I want to upload a file containing multiple recruiter contacts and group them by role or company, so that I can send highly personalized bulk emails with dynamic content and attachments efficiently.

---

### Acceptance Criteria

#### 📥 File Upload and Parsing

WHEN a user uploads a file in PDF, DOC, DOCX, or CSV format containing structured contact data,
THE Backend SHALL parse the file and extract records with the following fields per entry:

* name
* email
* title
* company

WHEN parsing is successful,
THE Backend SHALL store the extracted records in a bulk_contacts collection linked to the user ID.

IF any record is missing a required field (name or email),
THEN THE Backend SHALL skip that record and include it in a validation error report returned to the user.

IF the uploaded file exceeds 10MB or is in an unsupported format,
THEN THE Backend SHALL reject the upload with a 400 error indicating the reason.

---

#### 🧠 Grouping Logic

WHEN the user selects a grouping option,
THE system SHALL support the following grouping modes:

1. Group by Title
2. Group by Company

WHEN grouping is applied,
THE Backend SHALL organize contacts into groups based on the selected field value.

Example:

* Group by Title → { "Software Engineer": [...], "Backend Developer": [...] }
* Group by Company → { "Google": [...], "Amazon": [...] }

THE Backend SHALL store grouping metadata including:

* groupType (title/company)
* groupValue
* associated contact IDs

---

#### ✉️ AI-Based Email Template Generation per Group

WHEN groups are created,
THE Email_Generator SHALL generate one email template per group using AI (Ollama).

THE input to the AI SHALL include:

* group type (title/company)
* group value (e.g., "Backend Developer" or "Google")
* user profile data
* optional user prompt/context

THE output SHALL include:

* subject line (max 200 characters)
* email body (max 2000 characters)

THE system SHALL cache generated templates per group to avoid redundant AI calls.

---

#### 🔁 Dynamic Personalization per Recipient

BEFORE sending each email,
THE system SHALL dynamically inject recipient-specific values into the template:

* {{name}} → recipient name
* {{company}} → recipient company
* {{title}} → recipient title

WHEN rendering the final email,
THE system SHALL replace placeholders with actual values for each recipient.

Example:

Template:
"Hi {{name}}, I came across your work at {{company}}..."

Rendered:
"Hi Rishabh, I came across your work at Google..."

---

#### 📎 Attachment Handling

WHEN sending emails,
THE system SHALL attach a resume file which may be:

* the user's base resume, OR
* a job-customized resume (if available)

IF no resume is provided or linked to the user,
THEN THE Backend SHALL reject the request with an error.

---

#### 📤 Bulk Sending Execution

WHEN the user confirms sending,
THE Email_Generator SHALL enqueue one job per recipient in the BullMQ_Queue.

EACH job SHALL include:

* recipient email
* rendered subject
* rendered body
* attachment reference

THE system SHALL enforce rate limiting of:

* maximum 5 emails per minute

---

#### 📊 Result Tracking

WHEN the bulk mail job completes,
THE Backend SHALL return:

* total recipients
* successfully sent count
* failed count
* list of failed recipients with reasons

THE system SHALL also store:

* group metadata
* template used
* send status per recipient

---

#### 💻 Frontend Requirements

THE Frontend SHALL provide:

1. File upload component (PDF/DOC/CSV)
2. Grouping selector (Title / Company)
3. Group preview UI
4. Email template preview per group
5. Approval step before sending
6. Bulk send trigger button

WHEN a file is uploaded and parsed,
THE Frontend SHALL display grouped contacts and allow the user to review them.

WHEN templates are generated,
THE Frontend SHALL allow editing before sending.

---

#### ⚠️ Edge Cases and Validation

IF duplicate email addresses exist,
THE system SHALL deduplicate before sending.

IF an email address is invalid,
THE system SHALL exclude it and report it in validation errors.

IF a group contains zero valid recipients,
THE system SHALL skip that group.

IF AI generation fails for a group,
THE system SHALL allow fallback to manual template input.

---

#### ⚡ Performance Constraints

* File parsing SHALL complete within 10 seconds for up to 1000 records
* Grouping SHALL execute within 2 seconds
* Email template generation SHALL not exceed 5 seconds per group
* Bulk send jobs SHALL be processed asynchronously without blocking the API response

---

#### 🔒 Security Constraints

* Uploaded files SHALL be scanned for malicious content before parsing
* Email sending SHALL use authenticated SMTP credentials
* User data SHALL be isolated per user ID
* Templates SHALL not expose sensitive internal data

---

#### 🧠 Optimization Rules

* Generate AI email template once per group (NOT per user)
* Cache templates for reuse
* Avoid repeated parsing of the same file
* Use streaming or chunk parsing for large files


### Requirement 8: Job Scrape Cache Management

**User Story:** As a job seeker, I want to manage the scraped job cache, so that I can clear outdated listings or remove irrelevant results.

#### Acceptance Criteria

1. THE Backend SHALL expose an endpoint that returns cache statistics including: total job count, job count per source, flagged job count, jobs scraped within the last 24 hours, and oldest/newest scrape timestamps
2. THE Backend SHALL expose endpoints to delete cached jobs by source (returning the number of deleted jobs), by individual job ID (returning a deleted confirmation), or clear all cached jobs (returning the number of deleted jobs)
3. IF a delete-by-ID request references a job ID that does not exist, THEN THE Backend SHALL return a not-found error indicating the job ID is invalid
4. THE Backend SHALL expose a cleanup endpoint that accepts a days parameter (1-365, default 30) and deletes all jobs with a scrape timestamp older than the specified number of days, returning the count of deleted jobs
5. THE Frontend SHALL display cache statistics (total jobs, per-source counts, oldest/newest dates) and provide controls to clear cache by source or clear all cached jobs
6. THE Backend SHALL expose an endpoint to clear CAPTCHA flags from previously blocked job entries (jobs flagged due to CAPTCHA detection during scraping), returning the count of updated jobs

### Requirement 9: Background Job Monitoring

**User Story:** As a job seeker, I want to see the status of all background operations, so that I know when my resume parsing, job scraping, or email sending is complete.

#### Acceptance Criteria

1. THE Backend SHALL expose status endpoints for resume parse jobs, scrape jobs, and mail jobs that return: job type (resume-parse, job-scrape, or bulk-mail), state (queued, active, completed, or failed), progress as an integer percentage (0-100), result payload on completion, and failure reason on failure
2. WHEN a background job transitions state (queued, active, completed, failed), THE Backend SHALL make the updated state available via the status endpoint within 2 seconds
3. IF a status endpoint is queried with a job ID that does not exist in the queue, THEN THE Backend SHALL return an error response indicating the job was not found
4. THE Frontend SHALL poll each active background job's status endpoint at an interval no greater than 5 seconds and display job type, current state, and a progress indicator (0-100%)
5. IF a background job fails and the job type is resume-parse or job-scrape, THEN THE Frontend SHALL display the failure reason and offer a retry action that re-enqueues the same job
6. IF a background job fails and the job type is bulk-mail, THEN THE Frontend SHALL display the failure reason and the list of failed recipients without offering automatic retry

### Requirement 10: Application Logging and Observability

**User Story:** As a developer, I want structured logging across all services, so that I can debug issues and monitor system health.

#### Acceptance Criteria

1. THE Backend SHALL use Winston for structured logging with log levels configurable via the LOG_LEVEL environment variable, supporting the levels: error, warn, info, verbose, and debug
2. THE Backend SHALL include in every log entry at minimum: a timestamp in ISO 8601 format, the log level, a context label identifying the originating module, and the log message
3. WHEN a background job transitions through a lifecycle event (enqueued, started, progress update, completed, or failed), THE Backend SHALL log that event at info level, including the job ID, user ID, job queue name, and for completed jobs the duration in milliseconds
4. WHEN an external service interaction occurs (Cloudinary, Ollama, SMTP, or scraper HTTP call), THE Backend SHALL log the service name, operation performed, response time in milliseconds, and HTTP status code (where applicable) at info level
5. IF an external service call fails, THEN THE Backend SHALL log the error at error level with the service name, operation attempted, elapsed time in milliseconds, error message, and stack trace before propagating the error
6. IF a background job fails, THEN THE Backend SHALL log the failure at error level with the job ID, user ID, queue name, error message, and stack trace

### Requirement 11: JWT Authentication and Authorization

**User Story:** As a job seeker, I want to securely log in and have my sessions protected, so that only I can access my data and perform actions on my account.

#### Acceptance Criteria

1. WHEN a user registers with a password between 8 and 128 characters, THE Auth_Module SHALL hash the user's password using bcrypt with a minimum cost factor of 10 before storing it
2. WHEN a user submits valid credentials (email + password), THE Auth_Module SHALL issue a JWT access token (15-minute expiry) and a refresh token (7-day expiry)
3. IF a user submits invalid credentials, THEN THE Auth_Module SHALL return a 401 error without revealing whether the email or password was incorrect, and IF the same email accumulates 5 consecutive failed attempts, THEN THE Auth_Module SHALL lock the account for 15 minutes
4. WHEN a request includes a valid JWT access token in the Authorization header, THE Backend SHALL authenticate the request and attach the user identity to the request context
5. IF a request includes an expired or malformed JWT, THEN THE Backend SHALL return a 401 error with an "invalid token" message
6. WHEN a user submits a valid refresh token, THE Auth_Module SHALL issue a new access token and a new refresh token, revoking the previously used refresh token
7. IF a refresh token is expired or revoked, THEN THE Auth_Module SHALL return a 401 error requiring full re-authentication
8. THE Frontend SHALL store the access token in memory and the refresh token in an httpOnly cookie
9. WHEN the access token expires, THE Frontend SHALL automatically attempt to refresh it once using the stored refresh token before prompting re-login
10. THE Backend SHALL protect all endpoints except registration, login, and refresh with JWT authentication guards
11. WHEN a user requests logout, THE Auth_Module SHALL revoke the user's active refresh token and return a success response

### Requirement 12: AI-Powered Job-Resume Matching (RAG + ChromaDB)

**User Story:** As a job seeker, I want each job listing scored against my resume, so that I can prioritize the most relevant opportunities.

#### Acceptance Criteria

1. WHEN a user's resume is successfully parsed, THE Matching_Engine SHALL generate a vector embedding of the user's profile (skills, experience, education) using Ollama and store it in ChromaDB within 30 seconds of parse completion
2. WHEN new job listings are scraped, THE Matching_Engine SHALL generate vector embeddings for each job description and store them in ChromaDB
3. WHEN a user views their job listings, THE Matching_Engine SHALL return Match_Scores within 3 seconds by retrieving cached scores from MongoDB or computing cosine similarity between the user's profile embedding and each job embedding to produce a Match_Score (0-100)
4. THE Matching_Engine SHALL compute the final Match_Score as 70% cosine similarity score plus 30% skill overlap score, where skill overlap is the ratio of exact case-insensitive keyword matches between resume skills and job description keywords to the total number of resume skills, scaled to 0-100
5. THE Matching_Engine SHALL rank job listings by Match_Score in descending order by default
6. IF ChromaDB is unavailable, THEN THE Matching_Engine SHALL fall back to keyword-based skill matching and return a degraded Match_Score with a flag indicating reduced accuracy
7. IF Ollama is unavailable when generating embeddings, THEN THE Matching_Engine SHALL retry the embedding request up to 3 times with a 5-second delay between attempts and, if all retries fail, fall back to keyword-based skill matching with a degraded accuracy flag
8. IF a job listing has an empty or missing description, THEN THE Matching_Engine SHALL assign a Match_Score of 0 and flag the listing as "unscored" with an indication that no description was available
9. WHEN a user updates their profile, THE Matching_Engine SHALL regenerate the user's embedding and recompute Match_Scores for existing job listings, invalidating any previously cached scores for that user
10. THE Backend SHALL cache computed Match_Scores in MongoDB and invalidate the cache for a user when the user's profile is updated or when new job listings are added for that user's skill set
11. THE Frontend SHALL display the Match_Score as a percentage badge on each job card and support sorting by match score
12. THE Matching_Engine SHALL batch-process embeddings in groups of up to 50 jobs per batch to avoid overwhelming the Ollama server

### Requirement 13: Automated Job Application (Playwright)

**User Story:** As a job seeker, I want the system to automatically fill and submit job applications on supported platforms, so that I can apply to many jobs efficiently.

#### Acceptance Criteria

1. WHEN a user triggers auto-apply for a job listing, THE Auto_Applier SHALL launch a headless Chromium browser via Playwright and navigate to the job's apply URL within a 30-second page load timeout
2. WHEN the Auto_Applier navigates to an application form, THE Auto_Applier SHALL auto-fill form fields (name, email, phone, LinkedIn, resume upload) using the user's Profile data, matching fields by label text, input name, or placeholder attributes
3. WHEN the Auto_Applier encounters a form field it cannot map to profile data, THE Auto_Applier SHALL skip that field and record it in the application's tracked entry with field identifier and "requires manual review" flag visible on the applications page
4. IF a CAPTCHA, login wall, or unsupported form structure is encountered, THEN THE Auto_Applier SHALL abort the application within 10 seconds of detection, mark it as "requires manual action" in the Application_Tracker, and log the specific reason (captcha detected, login required, or unsupported form)
5. WHEN an application form is submitted and the Auto_Applier detects a confirmation indicator (URL change to a thank-you/confirmation path, or presence of a success message element on page), THE Auto_Applier SHALL record the application with status "applied", timestamp, and the job listing reference in the Application_Tracker
6. THE Auto_Applier SHALL enqueue application jobs on the BullMQ_Queue to process them asynchronously with configurable concurrency (default: 1 concurrent browser)
7. THE Auto_Applier SHALL support batch auto-apply where a user selects up to 50 job listings and the system processes them sequentially in the order selected
8. WHILE an auto-apply job is in progress, THE Backend SHALL report progress (current job index, total jobs, per-job status) via the status polling endpoint
9. THE Frontend SHALL display an applications page showing all tracked applications with status (applied, failed, requires manual action, pending), submission timestamp, and job listing title and company
10. IF Playwright browser launch fails, THEN THE Auto_Applier SHALL retry once after 5 seconds and, if the retry also fails, mark the application as "failed" in the Application_Tracker with the error reason
11. THE Auto_Applier SHALL rate-limit applications to a maximum of 10 per hour per platform to avoid triggering anti-bot measures
12. IF a job listing has no apply URL, THEN THE Auto_Applier SHALL reject the auto-apply request and mark the application as "failed" with reason "no apply URL available"
13. IF the Auto_Applier does not detect a submission confirmation within 60 seconds after clicking submit, THEN THE Auto_Applier SHALL mark the application as "failed" with reason "submission confirmation timeout"
