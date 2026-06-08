# Implementation State (Auto-Generated)

---

## ✅ Fully Implemented

### Users Module (backend/src/users/)
- **Features**: User creation (name + email), find by ID, find by email, resume data retrieval, profile CRUD, profile auto-extraction from parsed JSON/raw text
- **APIs**:
  - `POST /users` — Create user
  - `GET /users/by-email/:email` — Find by email
  - `GET /users/:id` — Get user
  - `GET /users/:id/resume` — Get resume data
  - `GET /users/:id/profile` — Get structured profile
  - `PATCH /users/:id/profile` — Update profile (manual edits)
  - `POST /users/:id/profile/extract` — Re-extract profile from resume
- **Schema**: User with name, email, resume (Object), resumeRawText, resumeCloudinaryUrl, resumeCloudinaryId, resumeVersions, profile (UserProfile)
- **Profile Fields**: phone, location, headline, bio, linkedin, github, website, skills, experience, education, certifications, languages, projects, lastUpdatedFrom, updatedAt

### File Upload / Resume Module (backend/src/file-upload/)
- **Features**: PDF upload to Cloudinary, text extraction via pdf-parse, BullMQ job queuing, Ollama LLM parsing (3-attempt retry with progressive prompts), job status polling, re-parse without re-upload, PDF proxy for inline display
- **APIs**:
  - `POST /uploads/resume` — Upload PDF, extract text, queue LLM parse
  - `GET /uploads/resume/status/:jobId` — Poll parse job status (state, progress 0-100, result)
  - `POST /uploads/resume/reparse` — Re-run LLM on stored text
  - `GET /uploads/resume/proxy?url=` — Proxy Cloudinary PDF for inline rendering
- **BullMQ**: Queue "resume-parse", processor calls Ollama /api/generate, 3 attempts with progressive prompt simplification, fallback skeleton on total failure
- **Ollama Helper**: JSON extraction, cleaning, repair, validation (checks for resume fields)

### Jobs Module (backend/src/jobs/)
- **Features**: Multi-source scraping (Indeed, Naukri, Internshala, Google Jobs, JSearch API), BullMQ job queuing, deduplication via SHA-256 hash, posted-date parsing (relative → ISO), skill matching with variant expansion, experience-level filtering (auto-derive from profile), cache management (stats, cleanup, clear by source/id/all, fix captcha flags), paginated listing with sorting
- **APIs**:
  - `POST /jobs/scrape` — Trigger scrape (skills, sources, companies, keywords, country)
  - `GET /jobs/scrape/status/:jobId` — Poll scrape status
  - `GET /jobs` — List jobs (paginated, filtered by skills/source/experience/sort)
  - `GET /jobs/skills/:userId` — Get extracted skills from resume
  - `POST /jobs/cleanup?days=N` — Remove jobs older than N days
  - `POST /jobs/fix-flags` — Clear captcha flags
  - `GET /jobs/cache/stats` — Cache statistics
  - `GET /jobs/cache` — List cached jobs (paginated)
  - `DELETE /jobs/cache/all` — Clear all
  - `DELETE /jobs/cache/source/:source` — Clear by source
  - `DELETE /jobs/cache/:id` — Delete single job
- **Scrapers**: 5 sources with browser automation (Playwright) + JSearch API, JD fetcher for top matches, contact email extraction from JD text
- **Schema**: Job with title, company, location, jd, contactEmail, applyUrl, scrapeUrl, source, scrapedAt, postedAt/postedAtDate, dedupeHash, matchedSkills, targetCompany, queryKeywords, flagged/flagReason

### Mail Module (backend/src/mail/)
- **Features**: Bulk email via SMTP with resume attachment, BullMQ async processing, configurable sender address with TTL, partial failure handling, job status polling, mail history/stats per user
- **APIs**:
  - `POST /mail/bulk` — Queue bulk email job (subject, context, recipients, resume)
  - `GET /mail/bulk/status/:jobId` — Poll job status
  - `GET /mail/history/:userId` — All mail jobs for user
  - `GET /mail/stats/:userId` — Aggregate mail stats
- **Processor**: Nodemailer SMTP, attachment from upload or Cloudinary, per-recipient send with partial results
- **MailFromService**: Sender address management with TTL expiration in MongoDB

### Logger Module (backend/src/logger/)
- **Features**: Winston-based structured logging, configurable log level via LOG_LEVEL env var, timestamped output, context labels
- **Levels**: error, warn, info, verbose, debug

### Frontend Application
- **Tech Stack**: React 18, TypeScript, Vite, TailwindCSS 4, React Router 7, TanStack React Query, Zustand, react-hook-form, react-hot-toast, Lucide icons, Axios
- **Pages**:
  - Signup (create user or "login" by email lookup)
  - Dashboard (home)
  - Profile (editable form)
  - Upload (resume PDF upload with progress)
  - Bulk Mail (compose and send)
  - Jobs (trigger scrape)
  - Job Listings (browse filtered results)
  - Cache (cache management UI)
- **API Client**: Complete coverage of all backend endpoints
- **State**: Zustand with localStorage persistence (user session)
- **Layout**: Sidebar navigation within DashboardLayout

---

## ⚠️ Partially Implemented

### Email Module — AI Generation
- **What exists**: Bulk sending with plain text body (user provides context manually), SMTP delivery, resume attachment, configurable sender
- **What is missing**:
  - AI-powered email body generation via Ollama (Requirement 7.1)
  - Bulk contact file upload (PDF/DOC/CSV parsing)
  - Contact grouping by title/company
  - Dynamic template personalization ({{name}}, {{company}}, {{title}})
  - Per-group AI template generation
  - Template caching and editing UI
  - Rate limiting (5 emails/min cap)
  - Deduplication of recipient emails
  - Invalid email filtering
  - Result tracking per recipient with group metadata

### Job Listing Filtering
- **What exists**: Filtering by skills, source, experience level (auto/specific), sorting by posted/scraped date, pagination
- **What is missing**:
  - Custom keyword filtering that matches against both title AND description (currently limited to title-level experience keywords)
  - Empty filter state message on frontend (backend returns empty list, frontend may not show friendly message)

### Background Job Monitoring
- **What exists**: Individual status endpoints per queue (resume parse, scrape, mail), polling from frontend
- **What is missing**:
  - Unified job monitoring dashboard showing ALL active jobs across all queues
  - Retry action from frontend for failed resume-parse/scrape jobs
  - Different handling for failed bulk-mail jobs (show failed recipients, no auto-retry)

### Application Logging
- **What exists**: Winston logger with configurable levels, timestamps, context labels
- **What is missing**:
  - Consistent structured logging of ALL background job lifecycle events with job ID + user ID + queue name + duration
  - External service interaction logging with response time + HTTP status (partially done — some services log, others don't)
  - Stack trace inclusion on all error-level logs

---

## ❌ Not Implemented

### JWT Authentication and Authorization
- No password field in User schema
- No bcrypt hashing
- No JWT token generation (access/refresh)
- No auth guards on endpoints
- No account lockout logic
- No logout/token revocation
- No protected routes on frontend
- No httpOnly cookie for refresh token
- No auto-refresh on token expiry

### AI-Powered Job-Resume Matching (RAG + ChromaDB)
- No ChromaDB integration
- No vector embedding generation via Ollama
- No cosine similarity computation
- No Match_Score calculation (70% cosine + 30% skill overlap)
- No score caching in MongoDB
- No score invalidation on profile update
- No batch embedding processing
- No fallback to keyword-only matching
- No Match_Score display on frontend job cards

### Automated Job Application (Playwright)
- No auto-apply module
- No form field detection and auto-fill
- No CAPTCHA/login wall detection
- No Application_Tracker schema
- No application status tracking (applied/failed/requires manual action/pending)
- No batch auto-apply
- No rate limiting per platform (10/hour)
- No applications page on frontend
- No submission confirmation detection

### Bulk Contact Upload and Grouping (Requirement 7.1)
- No file parsing for contacts (PDF/DOC/CSV)
- No bulk_contacts collection
- No grouping by title/company
- No AI template generation per group
- No dynamic placeholder injection
- No file upload component for contacts on frontend
- No group preview UI

### Multi-User Data Isolation
- No ownership checks on data access
- Any userId can access any user's data via API

---

## 🔁 Reusable Components

### Backend Services
- **UsersService** — Profile read/write, resume save → reuse for auth integration
- **UsersRepository** — MongoDB user operations → extend with password field
- **FileUploadService** — Cloudinary upload + pdf-parse → reuse for auto-apply resume upload
- **WinstonLoggerService** — Logging → inject into new modules
- **MailService + MailProcessor** — BullMQ email queue → extend for AI template generation
- **MailFromService** — Sender address management → reuse as-is
- **JobsRepository** — Skill matching, variant expansion → reuse for matching engine
- **BullMQ Infrastructure** — Already configured globally → add new queues for matching/auto-apply
- **Ollama Helper (parseResumeWithOllama)** — Ollama API integration pattern → adapt for email generation and embedding generation
- **Playwright Browser Helper (launchBrowser)** — Headless browser launch → reuse for auto-apply

### Frontend Services
- **api.ts** — Comprehensive API client → extend for new endpoints
- **useUserStore (Zustand)** — User state management → extend for auth tokens
- **DashboardLayout + Sidebar** — Navigation structure → add new routes
- **React Query** — Data fetching patterns → reuse for new pages
- **react-hook-form** — Form handling patterns → reuse for new forms
- **toast notifications** — Error/success feedback → reuse across new features

---

## 🚫 Do Not Modify

- **Job Schema + dedupeHash logic** — Core deduplication mechanism; changing hash algorithm would orphan existing records
- **Scrapers (Indeed, Naukri, Internshala, Google Jobs, JSearch)** — Working browser automation; fragile to changes
- **Ollama Helper prompt engineering** — Carefully tuned 3-attempt progressive prompts with JSON extraction/cleaning
- **Resume Parse Processor + flow** — Upload → Cloudinary → pdf-parse → BullMQ → Ollama pipeline is stable
- **Mail Processor SMTP logic** — Working partial-failure email delivery
- **BullMQ configuration (bull-redis.config.ts)** — Shared Redis connection config
- **Frontend API client (services/api.ts)** — Only extend, never rewrite
- **Frontend routing structure** — Add routes, don't restructure
- **User Schema** — Only extend with new fields (password, refreshTokens, etc.), don't rename/remove existing fields

---

## 🧠 Recommended Approach

### For JWT Authentication (Priority 1)
- Add `password` and `refreshTokens` fields to User schema
- Create new `backend/src/auth/` module with:
  - AuthController (register, login, refresh, logout)
  - AuthService (bcrypt, JWT sign/verify)
  - JwtAuthGuard (global except public routes)
  - JwtStrategy (passport-jwt)
- Update UsersService.create() to accept password
- Add guards to all existing controllers
- Frontend: Add login page, token storage, auto-refresh interceptor

### For Job-Resume Matching (Priority 2)
- Create new `backend/src/matching/` module
- Install ChromaDB client library
- Reuse Ollama connection pattern from ollama.helper.ts for embedding generation
- Add Match_Score field to Job schema (or separate MatchScore collection)
- Hook into resume parse completion and scrape completion events
- Add score display to frontend job cards

### For Auto-Apply (Priority 3)
- Create new `backend/src/auto-apply/` module
- Create Application schema/collection for tracking
- Reuse launchBrowser() from jobs/scraper/browser.helper.ts
- Add new BullMQ queue for application jobs
- Frontend: New /dashboard/applications page

### For Bulk Contact + AI Email (Priority 4)
- Extend existing Mail module (don't create new module)
- Add contact parsing service (pdf-parse for PDF, csv-parser for CSV)
- Add Ollama call for email body generation (reuse patterns from ollama.helper.ts)
- Add BulkContact schema to MongoDB
- Extend frontend BulkMail page with file upload + grouping UI

### General Principles
- **Extend, don't rewrite** — All modules are modular; add new services/controllers alongside existing ones
- **Reuse BullMQ patterns** — Follow existing queue registration and processor patterns
- **Match coding style** — DI injection, repository pattern, Swagger decorators on all endpoints
- **Frontend patterns** — React Query hooks, Zustand stores, TailwindCSS utility classes, toast notifications
