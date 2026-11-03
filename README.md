# TrialMatch

**Match patients to clinical trials.** Research coordinators keep a catalog of clinical trials with their eligibility criteria and a private list of de-identified patient profiles. One click finds the trials a patient could join: Claude checks the profile against every inclusion and exclusion criterion and explains each verdict, while a background worker streams progress live to the browser.

Built with **React 19 · TypeScript · NestJS · PostgreSQL · Drizzle ORM · Claude API · BullMQ · Redis · Server-Sent Events · Zod · TanStack Query · React Hook Form · Tailwind CSS · Nx monorepo · Docker · GitHub Actions**.

---

## Features

| Feature | How it works |
|---|---|
| **AI eligibility matching** | **Find matching trials** on a patient: candidate trials are found in SQL (recruiting, the patient's age and sex, then PostgreSQL full-text search over the patient's conditions, GIN-indexed). For each, **Claude** assesses every criterion as met / not met / unknown, with a reason and the words from the profile it relied on. Output is forced through a tool whose schema is generated from Zod, and validated again before it is stored |
| **Auditable decisions** | The overall result (likely eligible / needs review / not eligible) is computed by code from the per-criterion verdicts, never taken from the model: an exclusion that applies or an unmet inclusion rules the patient out; anything unknown needs a person. Results are labelled decision support |
| **Background jobs** | Matching runs on a **BullMQ** queue in Redis, with retries and exponential backoff for transient failures (rate limits, timeouts, malformed AI output). A bad API key fails at once with a clear message. Retries are idempotent. Without Redis (local development, tests) the same runner works in-process |
| **Live progress** | **Server-Sent Events**: the API streams each run's progress. Events travel through Redis pub/sub, so any API replica can stream a run processed by any worker. The React client reads the stream with `fetch` (the JWT goes in a header, not the URL), reconnects if it drops, and never moves a run backwards |
| **Works without an API key** | A transparent rule-based engine looks for each criterion's key terms in the profile (telling "Type 1" from "Type 2", and reading negations like "no history of") and otherwise answers unknown. The UI says which engine produced a result |
| **Prompt-injection hygiene** | Patient and trial text is escaped and placed inside tags, the system prompt says it is data, and the answer must fit the schema, so text in a profile can't make the app do anything but fill in assessments |
| **One schema for both apps** | Request validation lives in `libs/shared` as Zod schemas. The NestJS API validates requests with them (via `nestjs-zod`, which also generates the OpenAPI docs), and the React forms validate with the same schemas through React Hook Form. Change a field once and both apps fail to compile until they are updated |
| **Nx monorepo** | `apps/web` (React + Vite), `apps/api` (NestJS + webpack), `libs/shared`. Module-boundary lint rules allow the web app and the API to share code only through `libs/shared`; CI checks only the projects a pull request affects |
| **Authentication** | Register / sign in with Argon2-hashed passwords and signed JWTs. A global guard protects every route unless marked `@Public()`; the login endpoint is rate-limited and gives the same answer (and the same timing) for an unknown email and a wrong password |
| **Trials** | Search across title, condition, NCT ID and sponsor; filter by phase and status; paginate. Filters live in the URL, so a filtered list can be bookmarked and shared |
| **Eligibility criteria editor** | Add, reorder and remove inclusion / exclusion criteria (React Hook Form field arrays). The API numbers them I1, I2… / E1, E2… |
| **Private, de-identified patients** | A pseudonym (validated so it can't look like a real name), age, sex, conditions, medications and clinical notes. Every query is scoped to the owner: another user's patient or match run returns 404, exactly like one that doesn't exist |
| **Optimistic concurrency** | Every record has a `version`. Saves send only the changed fields plus the version they read; a stale save gets **409** with the current record, and the UI offers **Load their version** or **Save mine anyway** |
| **Consistent errors** | Every error has one shape (`ApiError`). Validation errors carry field-level messages that the forms show on the right field, including server-only checks such as a duplicate NCT ID |
| **Migrations** | Drizzle generates SQL migrations from the schema; the API applies them at startup under a PostgreSQL advisory lock, so two replicas never migrate at once. CI fails if the schema changes without a migration |
| **Production images** | Multi-stage Docker builds; the API runs as a non-root user with production dependencies only, and the web app is served by unprivileged nginx, which also proxies `/api` |

## Tech stack

- **Frontend:** React 19, TypeScript, React Router 7, TanStack Query 5, React Hook Form + Zod, Tailwind CSS 4, Vite
- **Backend:** NestJS 11, Drizzle ORM, PostgreSQL 17 (full-text search), Zod (`nestjs-zod`), OpenAPI/Swagger, JWT, Argon2, Helmet, rate limiting
- **AI and jobs:** Anthropic Claude API (forced tool use), BullMQ, Redis (queue + pub/sub), Server-Sent Events
- **Monorepo:** Nx 24 (project graph, affected commands, caching, module boundaries), npm workspaces
- **Testing:** Jest + Supertest (API integration tests on a real PostgreSQL), Vitest + Testing Library + Mock Service Worker (React), Vitest (shared schemas)
- **Ops:** Docker, Docker Compose, nginx, GitHub Actions

---

## Quick start (Docker)

```bash
docker compose up --build
```

- App: http://localhost:8080 (demo sign-in: `alice@trialmatch.dev` / `trialmatch-demo`, or `bob@trialmatch.dev`)
- API docs: http://localhost:3000/api/docs

All demo trials and patients are fictional. NCT99… ids are not real registrations.

**Try matching:** open **Patients → P-0001 → Find matching trials** and watch the progress bar, then open the criteria table. To use Claude, copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`; without a key the rule-based engine runs, so everything works offline.

**Try concurrency:** open the same trial as Alice in one window and as Bob in a private window. Save a change as Alice, then save as Bob: Bob sees the conflict banner and chooses what happens.

## Development setup

Needs Node.js 22.12+ and PostgreSQL (or just the backing services: `docker compose up -d db redis`).

```bash
npm install
npm run start:api      # http://localhost:3000/api  (applies migrations, seeds demo data)
npm run start:web      # http://localhost:4200      (proxies /api to the API)
```

Set `REDIS_URL=redis://localhost:6379` to use the BullMQ worker; without it, matching runs in-process. Change the database schema in `apps/api/src/app/db/schema.ts`, then run `npm run db:generate` and commit the new migration.

## Tests

```bash
npm test               # all projects
npx nx test api        # API tests (needs PostgreSQL: TEST_DATABASE_URL, default trialmatch_test on localhost)
npx nx test web        # React component tests
npm run lint           # ESLint (with module boundaries) + TypeScript
npx nx graph           # see the project graph
```

| Tests | What they prove |
|---|---|
| **API integration** (`apps/api/src/**/*.spec.ts`) | The real Nest app (guards, validation, error filter, migrations) against PostgreSQL: sign-in, 401s, field errors, NCT uniqueness, search with a literal `%`, pagination, 409 conflicts, owner-only patients and match runs, no 500s for odd ids, candidate selection, the event stream, retries then a clear failure |
| **Matching engines** (`apps/api/src/app/matching/engines.spec.ts`) | Claude engine with a mocked client: forced tool use, every criterion sent, skipped criteria filled in as unknown, malformed output and rate limits retryable, a bad key not, text escaped. Rule-based engine: "Type 1" vs "Type 2", negations |
| **React** (`apps/web/src/**/*.spec.tsx`) | Whole pages rendered with a mocked API (Mock Service Worker): sign-in redirects back, validation from the shared schemas, criteria reordering, field-only PATCH with the version, the 409 banner, sign-out on an expired token, a match run followed over an authenticated event stream to its per-criterion results |
| **Shared** (`libs/shared`) | The Zod rules (email normalisation, defaults, the age-range rule, pseudonyms) and the eligibility decision rule |

CI (`.github/workflows/ci.yml`): formatting, then lint + typecheck + tests + builds (only the affected projects on pull requests), a check that migrations match the schema, and a job that builds the production images, starts the stack (PostgreSQL, Redis, the API with its worker, nginx) and checks it from the outside, including a match run streamed through nginx.

## How a match run works

```
Browser ── POST /patients/:id/match-runs ──> API ── creates run (queued) ──> BullMQ queue (Redis)
   ▲                                                                              │
   │  GET /match-runs/:id/events (SSE)                                            ▼
   └──── API ◀── Redis pub/sub ◀── progress ◀── Worker: candidates (SQL) → Claude per trial → decide → save
```

| Situation | What happens |
|---|---|
| Rate limit, timeout, network error, malformed AI answer | Retried after 5s, then 10s (3 attempts); the stage text says so |
| Bad API key, invalid request | Fails at once: "The AI service rejected the API key. Check ANTHROPIC_API_KEY." |
| The model skips a criterion or invents one | Missing ones become "unknown, check by hand"; unknown ids are dropped |
| Same job delivered twice | The second delivery sees a finished run and does nothing; results are replaced, never duplicated |
| No conditions on the patient, or no recruiting trial fits | The run succeeds with no results and says why |
| The browser loses the stream | It reconnects and resumes from the current state |

## Project structure

```
trialmatch/
├── apps/
│   ├── api/                    NestJS API
│   │   └── src/app/
│   │       ├── auth/           Register, login, JWT guard, @Public(), @CurrentUser()
│   │       ├── trials/         Trials + criteria (search, filters, 409s)
│   │       ├── patients/       Owner-scoped patient profiles
│   │       ├── matching/       Engines (Claude, rules), runner, BullMQ queue, Redis events, SSE
│   │       ├── db/             Drizzle schema, migrations, seed data
│   │       ├── common/         Error filter (ApiError shape), Zod DTO helpers
│   │       └── setup.ts        Shared by main.ts and tests: Helmet, CORS, OpenAPI, migrations
│   └── web/                    React app
│       └── src/
│           ├── features/       auth, trials, patients, matching (pages, forms, TanStack Query hooks)
│           ├── components/     Layout, Field, TagInput, ConflictBanner, Pagination
│           ├── lib/            API client (incl. SSE over fetch), auth context, form helpers
│           └── testing/        Mock Service Worker setup and fixtures
├── libs/shared/                Zod schemas, types and the eligibility rule, used by both apps
└── docker-compose.yml          db, redis, api, web
```

## Roadmap

- [x] **Week 1:** Nx monorepo · NestJS API (auth, trials, patients) · React app · shared Zod schemas · tests · Docker · CI
- [x] **Week 2:** AI eligibility matching with Claude (a verdict and reason per criterion) · BullMQ background jobs · live progress over Server-Sent Events · full-text candidate search
- [ ] **Week 3:** Playwright end-to-end tests · Storybook component library · accessibility checks
- [ ] **Week 4:** Live deployment · monitoring
