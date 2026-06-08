# Tech Stack

## Backend
- **Runtime:** Node.js with TypeScript
- **Framework:** NestJS 10 (modules, controllers, services, repositories)
- **Database:** MongoDB via Mongoose 7 (`@nestjs/mongoose`)
- **Queue/Workers:** BullMQ with Redis (`@nestjs/bullmq`, `ioredis`)
- **Web scraping:** Playwright with Chromium for browser-based scraping
- **AI/LLM:** Ollama (local) for resume parsing
- **File storage:** Cloudinary for resume PDFs
- **PDF parsing:** `pdf-parse`
- **Email:** Nodemailer
- **API docs:** Swagger via `@nestjs/swagger`
- **Validation:** `class-validator` + `class-transformer`
- **Logging:** Winston
- **Linting:** ESLint + Prettier (single quotes, trailing commas)

## Frontend
- **Framework:** React 18 with TypeScript
- **Build tool:** Vite 5
- **Styling:** Tailwind CSS 4
- **Routing:** React Router DOM 7
- **State management:** Zustand 5
- **Server state:** TanStack React Query 5
- **Forms:** React Hook Form 7
- **HTTP client:** Axios
- **Icons:** Lucide React
- **Notifications:** React Hot Toast

## Common Commands

### Backend (`/backend`)
```bash
npm run start:dev      # Dev server with hot reload
npm run build          # Compile to dist/
npm run start:prod     # Run compiled output
npm run lint           # ESLint with auto-fix
npm run format         # Prettier format
npm run test           # Unit tests (Jest)
npm run test:e2e       # End-to-end tests
```

### Frontend (`/frontend`)
```bash
npm run dev            # Vite dev server (port 5173)
npm run build          # TypeScript check + Vite build
npm run lint           # ESLint
npm run preview        # Preview production build
```

## Code Style
- Single quotes, trailing commas (Prettier)
- No explicit return types enforced
- `any` is allowed (`@typescript-eslint/no-explicit-any: off`)
- `strictNullChecks` is disabled in backend tsconfig
- Backend uses CommonJS modules; frontend uses ES modules
