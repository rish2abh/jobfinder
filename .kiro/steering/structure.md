# Project Structure

```
Jobfinder/
├── backend/                    # NestJS API server
│   └── src/
│       ├── main.ts             # App bootstrap, CORS, Swagger, validation pipes
│       ├── app.module.ts       # Root module wiring all feature modules
│       ├── app.controller.ts   # Health/root endpoint
│       ├── app.service.ts
│       ├── file-upload/        # Resume upload & AI parsing pipeline
│       │   ├── file-upload.controller.ts
│       │   ├── file-upload.service.ts
│       │   ├── resume-parse.processor.ts   # BullMQ worker for async resume parsing
│       │   ├── ollama.helper.ts            # LLM interaction for structured extraction
│       │   ├── resume-job.types.ts         # Queue constants & job payload types
│       │   └── dto/
│       ├── jobs/               # Job scraping & listing management
│       │   ├── jobs.controller.ts
│       │   ├── jobs.service.ts
│       │   ├── jobs.repository.ts          # Mongoose data access layer
│       │   ├── job.schema.ts               # Mongoose schema + deduplication helpers
│       │   ├── job-scrape.processor.ts     # BullMQ worker for scrape jobs
│       │   ├── job-scrape.types.ts
│       │   ├── dto/
│       │   └── scraper/                    # Per-source scraper implementations
│       │       ├── indeed.scraper.ts
│       │       ├── naukri.scraper.ts
│       │       ├── internshala.scraper.ts
│       │       ├── jsearch.scraper.ts
│       │       ├── google-jobs.scraper.ts
│       │       ├── browser.helper.ts       # Shared Playwright browser management
│       │       ├── jd-fetcher.ts           # Full JD page fetch
│       │       └── query-builder.ts        # Search query construction
│       ├── mail/               # Bulk email sending via BullMQ
│       │   ├── mail.controller.ts
│       │   ├── mail.service.ts
│       │   ├── mail.processor.ts           # BullMQ worker for sending emails
│       │   ├── mail-from.schema.ts         # Sender identity Mongoose schema
│       │   ├── mail-from.service.ts
│       │   ├── bull-redis.config.ts        # Shared Redis connection builder
│       │   └── dto/
│       ├── users/              # User profiles & resume data
│       │   ├── users.controller.ts
│       │   ├── users.service.ts
│       │   ├── users.repository.ts
│       │   ├── user.schema.ts              # User + nested profile sub-schemas
│       │   ├── profile-extractor.ts        # Regex fallback for profile fields
│       │   └── dto/
│       └── logger/             # Custom Winston logger
│           ├── logger.module.ts
│           └── winston-logger.service.ts
├── frontend/                   # React SPA
│   └── src/
│       ├── main.tsx            # Entry point
│       ├── App.tsx             # Router + providers
│       ├── pages/              # Route-level page components
│       │   ├── Signup.tsx
│       │   ├── Dashboard.tsx
│       │   ├── Profile.tsx
│       │   ├── Upload.tsx
│       │   ├── BulkMail.tsx
│       │   ├── Jobs.tsx
│       │   ├── JobListings.tsx
│       │   └── Cache.tsx
│       ├── components/         # Shared UI components
│       ├── services/           # API client functions (Axios)
│       └── store/              # Zustand state stores
└── .kiro/                      # Kiro config, specs, steering
```

## Architecture Patterns

### Backend
- **Module-based architecture:** Each domain (jobs, users, mail, file-upload) is a self-contained NestJS module with its own controller, service, repository, and schema
- **Repository pattern:** Mongoose data access is isolated in `*.repository.ts` files
- **Async workers:** Long-running tasks (scraping, resume parsing, email sending) run in BullMQ processors, not in request handlers
- **DTO validation:** All incoming requests validated via `class-validator` decorators in `dto/` folders
- **Deduplication:** Jobs use SHA-256 hash of title+company for uniqueness

### Frontend
- **Page-based routing:** Each route maps to a page component under `pages/`
- **Layout wrapping:** Dashboard pages share a `DashboardLayout` with sidebar
- **Server state:** React Query manages API data fetching and caching
- **Client state:** Zustand for UI/session state
- **Forms:** React Hook Form for form state and validation
