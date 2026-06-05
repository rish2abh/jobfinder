<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="200" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://coveralls.io/github/nestjs/nest?branch=master" target="_blank"><img src="https://coveralls.io/repos/github/nestjs/nest/badge.svg?branch=master#9" alt="Coverage" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Jobfinder Backend

This service provides a resume ingestion pipeline and user management API built with NestJS. Core responsibilities:
- Accept resume file uploads and store files in Cloudinary
- Extract raw text from PDFs using `pdf-parse`
- Send extracted text to an on-prem LLM (Ollama) to convert resumes to structured JSON
- Persist users and parsed resume JSON to MongoDB (Mongoose)

**Core modules**
- `users` — user CRUD and resume storage (Mongoose schema)
- `file-upload` — file upload endpoint, Cloudinary integration, PDF text extraction, Ollama parsing
- `ConfigModule` + environment variables for credentials and endpoints

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Copy environment variables from `.env.example` to `.env` and fill values:

- `MONGODB_URI` — MongoDB connection string
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` — Cloudinary credentials
- `CLOUDINARY_UPLOAD_FOLDER` — optional folder path for uploads
- `OLLAMA_URL` — Ollama server base URL (e.g. `http://127.0.0.1:11434`)
- `OLLAMA_MODEL` — model name used by Ollama (default in example: `llama2`)

3. Run the app (development):

```bash
npm run start:dev
```

## Workflow overview

1. Client uploads a resume PDF to `POST /uploads/resume` with multipart form `file` and `userId` field.
2. Backend uploads the file to Cloudinary and stores returned URL/ID.
3. Backend extracts text from the PDF using `pdf-parse`.
4. Backend sends the raw text to the Ollama API (`/v1/completions`) with a prompt that requests JSON structured resume data.
5. Backend parses the LLM response into JSON and saves the parsed resume, raw text, and Cloudinary metadata onto the user's record in MongoDB.

## REST API

- Create user

  - Endpoint: `POST /users`
  - Body (JSON):

    ```json
    { "name": "Alice", "email": "alice@example.com" }
    ```

  - Response: created user object (MongoDB document)

- Get user

  - Endpoint: `GET /users/:id`
  - Response: user document including `resume` (structured JSON) if present

- Get user resume

  - Endpoint: `GET /users/:id/resume`
  - Response: `{ resume, rawText, cloudinaryUrl }`

- Upload resume

  - Endpoint: `POST /uploads/resume`
  - Form fields: `file` (pdf) and `userId` (string)
  - Behavior: uploads to Cloudinary, extracts text, sends to Ollama for JSON conversion, saves parsed JSON and metadata on the user

  - Example curl (replace values):

    ```bash
    curl -X POST "http://localhost:3000/uploads/resume" \
      -F "file=@/path/to/resume.pdf" \
      -F "userId=64a1f2..."
    ```

## Data model (high level)

- `User` (Mongoose)
  - `name`, `email`, `resume` (object), `resumeRawText`, `resumeCloudinaryUrl`, `resumeCloudinaryId`

## Notes & operational considerations

- Ollama: this project expects an Ollama server reachable at `OLLAMA_URL`. Ollama is called synchronously — consider adding retries, timeouts, or a background job if parsing becomes slow.
- Security: validate and authenticate requests before allowing uploads in production. Current endpoints are minimal for development.
- File size: multer memory storage is used with a 15 MB file limit; adjust as needed.
- Error handling: service layers throw HTTP exceptions that propagate to clients. Inspect logs for Cloudinary/LLM errors.

## Development and debugging

- Build:

```bash
npm run build
```

- Run tests:

```bash
npm run test
```

## Where to look in the code

- Users module: [src/users](src/users)
- File upload & LLM: [src/file-upload](src/file-upload)
- App bootstrap and config: [src/app.module.ts](src/app.module.ts)

---

If you want, I can add OpenAPI docs, authentication, background processing for parsing, or sample Postman collection next.
