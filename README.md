# Jobfinder

Jobfinder is a full-stack AI-powered job search assistant that automates the entire job hunt pipeline — from resume parsing to job discovery, intelligent matching, automated applications, and recruiter outreach.

---

## Core Features

1. **AI Resume Parsing** — Upload a PDF and get structured JSON (skills, experience, education, projects) extracted automatically using LLMs
2. **Multi-Source Job Scraping** — Discover jobs from 5+ platforms in one click using headless browser automation
3. **Intelligent Job Matching** — Vector embeddings + skill overlap scoring ranks jobs by how well they fit your profile
4. **One-Click Auto-Apply** — Playwright fills and submits job application forms automatically with your profile data
5. **AI-Powered Cold Outreach** — Generate personalized recruiter emails per contact group, review them, and send in bulk
6. **Full Application Tracking** — Track every application status from pending to applied/failed across all platforms

---

## AI Providers Used

| Provider | Usage | Model |
|----------|-------|-------|
| **Google Gemini** | Agent orchestrator (tool-calling loop) | `gemini-2.5-flash` (configurable) |
| **Anthropic Claude** | Resume parsing (primary) | `claude-sonnet-4-20250514` |
| **Ollama (Local)** | Resume parsing (fallback), email templates (fallback), vector embeddings | Configurable (default: `mistral` for text, `nomic-embed-text` for embeddings) |
| **Groq** | Email template generation (primary) | `llama-3.3-70b-versatile` (configurable) |
| **ChromaDB** | Vector database for storing and querying profile/job embeddings | Cosine similarity space |

### How AI is Used

- **Agent Orchestration** — User messages are sent to Gemini with tool declarations. Gemini decides which tools to call, executes them in a loop, and synthesizes a final response. Temperature is left at default (1.0) — setting it to 0 causes looping in Gemini 3-series models.
- **Resume Parsing** — Raw PDF text is sent to Claude (or Ollama fallback) with a structured prompt. The LLM returns a JSON object with normalized fields. Retries up to 3 times with error feedback on failure.
- **Email Template Generation** — User profile + contact group info is sent to Groq (Ollama fallback) to generate personalized cold email subject + body as JSON. Templates support `{{name}}` and `{{company}}` placeholders.
- **Vector Embeddings** — User profiles and job descriptions are embedded using Ollama's `nomic-embed-text` model and stored in ChromaDB. Cosine similarity is computed to rank job matches.
- **Match Scoring** — Final scores combine embedding cosine similarity with keyword-level skill overlap for a hybrid ranking approach.

---

## Key Features (Detailed)

### Resume Management
- **PDF Upload & Storage** — Upload resumes via the UI; files stored securely on Cloudinary
- **AI-Powered Parsing** — Claude API extracts structured data (skills, experience, education, projects) with Ollama as fallback
- **Smart Retry Logic** — Up to 3 attempts with error feedback if JSON extraction fails
- **Background Processing** — Resume parsing runs asynchronously via BullMQ workers so the UI stays responsive
- **Profile Extraction** — Regex-based fallback extracts phone, email, and links if LLM fails

### Job Scraping
- **Multi-Source Scraping** — Pulls listings from Indeed, Naukri, Internshala, Google Jobs, and JSearch API
- **Playwright-Based** — Uses headless Chromium for sites that require JavaScript rendering
- **Configurable** — Filter by skills, sources, companies, keywords, country, and max results per source
- **Deduplication** — SHA-256 hash of title+company prevents storing duplicate listings
- **Cache Management** — View, filter, and clear cached jobs per source with stats dashboard

### AI Job Matching
- **Embedding-Based Scoring** — Computes cosine similarity between user profile and job descriptions using `nomic-embed-text` embeddings
- **ChromaDB Vector Store** — Profile and job embeddings stored in ChromaDB collections with HNSW cosine space
- **Skill Overlap Analysis** — Combines semantic similarity with keyword-level skill matching for a hybrid final score
- **Async Recomputation** — Scores calculated in background via BullMQ; results cached in MongoDB
- **Auto-Recompute on Profile Update** — Scores are invalidated and re-embedded when your profile changes
- **Sorted Rankings** — Jobs ranked by match percentage, filterable and paginated
- **Graceful Degradation** — Falls back to skill-only matching if embedding service is unavailable

### Auto-Apply
- **One-Click Apply** — Automatically fills and submits job application forms using Playwright browser automation
- **Intelligent Form Filling** — Detects form fields and maps profile data (name, email, phone, links) to the correct inputs
- **Resume Upload** — Automatically attaches your Cloudinary-hosted resume PDF to applications
- **Batch Apply** — Apply to up to 50 jobs in a single batch, processed sequentially
- **Platform Detection** — Identifies the job platform (Indeed, Naukri, Internshala, LinkedIn) from the URL
- **Blocker Detection** — Detects CAPTCHAs, login walls, and other blockers before wasting time
- **Confirmation Detection** — Verifies successful form submission on target sites
- **Application Tracking** — Tracks status per job: pending, applied, failed, requires manual action
- **Stats Dashboard** — View application statistics and history

### Bulk Contact & Outreach
- **Contact Upload** — Import recruiter contacts from CSV, PDF, or DOCX files (up to 10MB)
- **Smart Grouping** — Automatically groups contacts by job title or company
- **AI Email Templates** — Generates personalized cold email templates per group using Groq LLM (with Ollama fallback)
- **Cold Email Best Practices** — AI prompts encode proven outreach strategies: curiosity-driven subjects, role-aware tone, low-friction CTAs
- **Placeholder Support** — Templates use `{{name}}` and `{{company}}` for per-recipient personalization
- **Template Editing** — Review and customize AI-generated templates before sending
- **Template Caching** — Generated templates are cached per group to avoid redundant AI calls
- **Rate-Limited Sending** — Sends personalized emails at 5/minute to avoid spam filters
- **Status Polling** — Track bulk send progress in real time

### Bulk Mail
- **Direct Email Sending** — Send resume to multiple recipients with a custom subject and body
- **Resume Attachment** — Attach uploaded resume or provide a new PDF per send
- **Job History** — View past mail jobs with sent/failed counts
- **Custom Sender** — Configurable sender address with TTL support

### Authentication & Security
- **JWT Access Tokens** — Short-lived tokens for API authentication
- **httpOnly Refresh Tokens** — Stored in secure cookies, auto-rotated on refresh
- **Account Lockout** — Protection against brute-force login attempts
- **Protected Routes** — All dashboard routes require authentication

### Dashboard & UI
- **Overview Dashboard** — Profile stats, resume status, quick actions, mail stats, and background job monitor
- **Profile Management** — View and manage user profile data
- **Real-Time Progress** — Live polling for scrape jobs, mail jobs, and match computations
- **Responsive Design** — Tailwind CSS 4 with mobile-friendly layouts

### AI Agent (Gemini-Powered Orchestrator)
- **Conversational Interface** — Chat with an AI agent that can execute multi-step job search workflows
- **Gemini 2.5 Flash** — Powered by Google's Gemini model with function calling for tool orchestration
- **Tool Calling Loop** — Agent iteratively calls tools (up to 8 iterations) until the task is complete
- **6 Agent Tools** — Resume matching, job discovery, auto-apply, cold email drafting, inbox checking, reply drafting
- **Action Journal** — Every agent interaction and tool call is logged for transparency
- **Draft Approval Workflow** — Emails are drafted first, requiring explicit user approval before sending
- **Guardrails** — Safety policies prevent unauthorized applies and enforce approval for sends
- **Multi-Turn Context** — Conversations maintain context across multiple messages

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend Framework** | NestJS 10 (TypeScript) |
| **Database** | MongoDB via Mongoose 7 |
| **Vector Database** | ChromaDB (cosine similarity HNSW) |
| **Queue/Workers** | BullMQ + Redis (via ioredis) |
| **Web Scraping** | Playwright with Chromium |
| **AI — Agent Orchestrator** | Google Gemini API (function calling) |
| **AI — Resume Parsing** | Anthropic Claude API (primary), Ollama (fallback) |
| **AI — Email Generation** | Groq SDK with Llama 3.3 70B (primary), Ollama (fallback) |
| **AI — Embeddings** | Ollama with `nomic-embed-text` model |
| **File Storage** | Cloudinary |
| **PDF Parsing** | pdf-parse, mammoth (DOCX) |
| **Email** | Nodemailer |
| **API Docs** | Swagger (@nestjs/swagger) |
| **Frontend Framework** | React 18 (TypeScript) |
| **Build Tool** | Vite 5 |
| **Styling** | Tailwind CSS 4 |
| **Routing** | React Router DOM 7 |
| **State Management** | Zustand 5 |
| **Server State** | TanStack React Query 5 |
| **Forms** | React Hook Form 7 |
| **Notifications** | React Hot Toast |

---

## Project Structure

```
Jobfinder/
├── backend/                      # NestJS API server
│   └── src/
│       ├── auth/                 # JWT auth, login, register, refresh, guards
│       ├── users/                # User profiles & resume data persistence
│       ├── file-upload/          # Resume upload, Cloudinary, PDF parsing, Ollama
│       ├── jobs/                 # Job scraping, cache, multi-source scrapers
│       │   └── scraper/          # Indeed, Naukri, Internshala, Google, JSearch
│       ├── matching/             # AI match scoring, embeddings, async recompute
│       ├── auto-apply/           # Playwright form-filling, batch apply, tracking
│       ├── bulk-contact/         # Contact upload/grouping, AI templates, bulk send
│       ├── mail/                 # Bulk email queue, Nodemailer, job history
│       ├── agent/                # Gemini-powered AI agent orchestrator
│       │   ├── tools/            # Tool implementations (6 tools)
│       │   ├── journal/          # Action audit log (MongoDB)
│       │   ├── drafts/           # Email drafts with approval workflow
│       │   └── guardrails/       # Safety policies for tool execution
│       └── logger/               # Winston logging
├── frontend/                     # React SPA
│   └── src/
│       ├── pages/                # Dashboard, Jobs, Matching, Applications, Contacts...
│       ├── components/           # Shared UI (DashboardLayout, ResumeViewer, etc.)
│       ├── services/             # Axios API client
│       └── store/                # Zustand state stores
└── .kiro/                        # Kiro config & steering files
```

---

## Setup

### Prerequisites

- Node.js 18+
- MongoDB (local or Atlas)
- Redis (for BullMQ job queues)
- Ollama (local LLM server — used for embeddings and as fallback for parsing/templates)
- ChromaDB (vector database for job matching embeddings)
- Cloudinary account (for resume file storage)
- Anthropic API key (for Claude resume parsing)
- Groq API key (optional — for AI email template generation)

### Backend

```bash
cd backend
npm install
cp .env.example .env    # Fill in your credentials
npm run start:dev       # Dev server with hot reload on port 4000
```

**Required environment variables:**

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | MongoDB connection string |
| `REDIS_HOST` / `REDIS_PORT` | Redis for BullMQ |
| `JWT_SECRET` | Secret for JWT signing |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |
| `GEMINI_API_KEY` | Google Gemini API key (agent orchestrator) |
| `GEMINI_ORCHESTRATOR_MODEL` | Gemini model (default: `gemini-2.5-flash`) |
| `AGENT_MAX_TOOL_ITERATIONS` | Max tool-calling loop iterations (default: 8) |
| `AGENT_AUTO_APPLY_MIN_SCORE` | Min match score for auto-apply (default: 0.8) |
| `AGENT_REQUIRE_APPROVAL_FOR_SEND` | Require user approval before sending emails (default: true) |
| `ANTHROPIC_API_KEY` | Anthropic Claude API key (resume parsing) |
| `CLAUDE_MODEL` | Claude model name (default: `claude-sonnet-4-20250514`) |
| `OLLAMA_URL` | Ollama server URL (e.g. `http://127.0.0.1:11434`) |
| `OLLAMA_MODEL` | Ollama model name (default: `mistral`) |
| `GROQ_API_KEY` | Groq API key (AI email templates) |
| `GROQ_MODEL` | Groq model name (default: `llama-3.3-70b-versatile`) |
| `CHROMADB_URL` | ChromaDB server URL (default: `http://localhost:8000`) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | SMTP config for email sending |

### Frontend

```bash
cd frontend
npm install
npm run dev             # Vite dev server on port 5173
```

---

## Available Scripts

### Backend (`/backend`)

| Command | Description |
|---------|-------------|
| `npm run start:dev` | Dev server with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start:prod` | Run compiled output |
| `npm run lint` | ESLint with auto-fix |
| `npm run format` | Prettier format |
| `npm run test` | Unit tests (Jest) |
| `npm run test:e2e` | End-to-end tests |

### Frontend (`/frontend`)

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server (port 5173) |
| `npm run build` | TypeScript check + Vite build |
| `npm run lint` | ESLint |
| `npm run preview` | Preview production build |
| `npm run test` | Unit tests (Vitest) |

---

## API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Register a new account |
| POST | `/auth/login` | Login with email/password |
| POST | `/auth/refresh` | Refresh access token (cookie-based) |
| POST | `/auth/logout` | Logout and revoke refresh token |
| GET | `/auth/me` | Get current authenticated user |

### Users
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/users/:id` | Get user details |
| GET | `/users/:id/resume` | Get parsed resume data |

### File Upload
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/uploads/resume` | Upload resume PDF and trigger AI parsing |

### Jobs
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/jobs/scrape` | Trigger multi-source job scraping |
| GET | `/jobs/scrape/status/:jobId` | Poll scrape job status |
| GET | `/jobs` | List jobs (filterable by skill, source, level) |
| GET | `/jobs/skills` | Get user's extracted skills |
| GET | `/jobs/cache/stats` | Cache statistics |
| GET | `/jobs/cache` | List cached jobs |
| DELETE | `/jobs/cache/all` | Clear all cached jobs |

### Matching
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/matching/scores/:userId` | Get match scores (paginated) |
| POST | `/matching/recompute/:userId` | Force recompute all scores |
| GET | `/matching/status/:jobId` | Poll matching job status |

### Applications (Auto-Apply)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/applications/apply` | Auto-apply to a single job |
| POST | `/applications/batch-apply` | Batch apply (up to 50 jobs) |
| GET | `/applications/status/:jobId` | Poll apply job status |
| GET | `/applications/list/:userId` | List tracked applications |
| GET | `/applications/stats/:userId` | Application statistics |

### Contacts (Bulk Outreach)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/contacts` | Get all uploaded contacts |
| POST | `/contacts/upload` | Upload contact file (CSV/PDF/DOCX) |
| POST | `/contacts/group` | Group contacts by title/company |
| GET | `/contacts/groups` | Get contact groups |
| POST | `/contacts/generate-templates` | AI-generate email templates |
| GET | `/contacts/templates` | Get saved templates |
| PATCH | `/contacts/templates/:groupId` | Edit a template |
| POST | `/contacts/send` | Trigger bulk send |
| GET | `/contacts/send/status/:jobId` | Poll send status |

### Mail
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/mail/bulk` | Queue bulk email job |
| GET | `/mail/bulk/status/:jobId` | Poll mail job status |
| GET | `/mail/history` | Get mail job history |
| GET | `/mail/stats` | Get aggregate mail stats |

### Agent
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/agent/chat` | Send a message to the AI agent |
| GET | `/agent/journal` | Get action journal (paginated) |
| GET | `/agent/journal/:conversationId` | Get journal for a conversation |
| GET | `/agent/drafts` | List email drafts |
| GET | `/agent/drafts/:id` | Get a specific draft |
| PATCH | `/agent/drafts/:id/approve` | Approve a draft for sending |
| PATCH | `/agent/drafts/:id/reject` | Reject a draft |
| PATCH | `/agent/drafts/:id/edit` | Edit draft content |

---

## Architecture Highlights

- **Module-Based** — Each domain is a self-contained NestJS module with controller, service, repository, and schema
- **Repository Pattern** — Data access isolated in `*.repository.ts` files
- **Async Workers** — Long-running tasks (scraping, parsing, emailing, matching) run in BullMQ processors
- **DTO Validation** — All requests validated via `class-validator` decorators
- **Protected Routes** — Frontend uses `ProtectedRoute` wrapper; backend uses JWT guards globally
- **Real-Time Feedback** — Frontend polls job status endpoints for live progress updates

---

## Feature Status

| Feature | Status |
|---------|--------|
| Resume Upload & AI Parsing | ✅ Complete |
| User Auth (JWT + Refresh) | ✅ Complete |
| Multi-Source Job Scraping | ✅ Complete |
| Job Cache Management | ✅ Complete |
| AI Job Matching | ✅ Complete |
| Auto-Apply (Single + Batch) | ✅ Complete |
| Application Tracking | ✅ Complete |
| Bulk Contact Upload & Grouping | ✅ Complete |
| AI Email Template Generation | ✅ Complete |
| Rate-Limited Bulk Send | ✅ Complete |
| Bulk Mail with Attachments | ✅ Complete |
| Gemini AI Agent Orchestrator | ✅ Complete |
| Agent Tool Calling (6 tools) | ✅ Complete |
| Draft Approval Workflow | ✅ Complete |
| Agent Action Journal | ✅ Complete |
| Agent Guardrails | ✅ Complete |
| Swagger API Documentation | ✅ Complete |
| Frontend Dashboard | ✅ Complete |

---

## License

UNLICENSED — Private project.
