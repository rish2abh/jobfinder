# Jobfinder

Jobfinder is a full-stack job search and resume management application with automated resume parsing and candidate matching. It combines a NestJS backend for file upload, resume extraction, and user management with a React + Vite frontend for a modern user experience.

## Project overview

- Backend: `backend/` — NestJS API, MongoDB data persistence, Cloudinary file upload, Ollama resume parsing.
- Frontend: `frontend/` — React + TypeScript + Vite user interface.
- Goal: enable users to upload resumes, parse resume content into structured data, and manage user and application data.

## Key features

- Resume upload endpoint with file validation and Cloudinary storage
- PDF text extraction and LLM-driven resume JSON parsing
- User creation, retrieval, and resume management
- Modular backend architecture using NestJS modules and services
- Frontend powered by React, Vite, and TypeScript
- Clear separation of backend and frontend responsibilities

## Architecture

### Backend architecture

The backend is structured as a NestJS monorepo with feature-based modules:

- `src/app.module.ts` — application root module and dependency wiring
- `src/users/` — user CRUD, Mongoose schema, and user-related API endpoints
- `src/file-upload/` — resume upload controller, Cloudinary integration, PDF parsing, and Ollama helper
- `src/auto-apply/`, `src/bulk-contact/`, `src/jobs/` — additional services for job automation, bulk contact, and job scraping
- `src/auth/` — authentication module, JWT guard, and strategy for securing endpoints
- `src/logger/` — centralized logging and application diagnostics

### Data flow

1. User uploads a resume file via the frontend or API.
2. Backend receives the file and uploads it to Cloudinary.
3. Backend extracts raw text from the PDF.
4. Raw text is sent to the Ollama LLM service to convert resume content into structured JSON.
5. Parsed resume data is persisted in MongoDB via Mongoose.
6. User data and resume results are served through REST API endpoints.

### Frontend architecture

The frontend is a Vite-powered React application:

- `src/App.tsx` — main application shell and routing entrypoint
- `src/components/` — reusable UI components
- `src/pages/` — page-level views for the application
- `src/services/` — API client helpers and request logic
- `src/store/` — application state management

## Setup

### Backend setup

1. Open a terminal in `backend/`
2. Install dependencies:

```bash
npm install
```

3. Copy environment variables from `.env.example` into `.env`
4. Fill required values:

- `MONGODB_URI`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `CLOUDINARY_UPLOAD_FOLDER`
- `OLLAMA_URL`
- `OLLAMA_MODEL`

5. Start the backend:

```bash
npm run start:dev
```

### Frontend setup

1. Open a terminal in `frontend/`
2. Install dependencies:

```bash
npm install
```

3. Start the frontend:

```bash
npm run dev
```

## Available scripts

### Backend

- `npm run start:dev` — run backend in development mode
- `npm run build` — compile TypeScript
- `npm run test` — run backend tests

### Frontend

- `npm run dev` — run Vite development server
- `npm run build` — build production frontend bundle
- `npm run preview` — preview built frontend locally

## API summary

- `POST /users` — create a new user
- `GET /users/:id` — get user details
- `GET /users/:id/resume` — get resume data for a user
- `POST /uploads/resume` — upload a resume file and parse it

## Notes

- The backend currently expects an Ollama server for resume parsing. Add retries and error handling for production readiness.
- Authentication and request validation should be enhanced before deploying publicly.
- File size limits and upload security are important concerns for production use.

## Where to look in the code

- Backend: `backend/src/`
- Frontend: `frontend/src/`

---

If you want, I can also add a more detailed architecture diagram or a dedicated developer guide for each service module.