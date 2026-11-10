# TrialMatch

**Match patients to clinical trials.** Research coordinators keep a catalog of clinical trials with their eligibility criteria and a private list of de-identified patient profiles. One click finds the trials a patient could join: Claude checks the profile against every inclusion and exclusion criterion and explains each verdict, while a background worker streams progress live to the browser.

**Live demo:** _coming soon_ (sign in as `alice@trialmatch.dev` / `trialmatch-demo`) · **Component library:** https://sonyshankar2k.github.io/trialmatch/

Built with **React 19 · TypeScript · NestJS · PostgreSQL · Drizzle ORM · Claude API · BullMQ · Redis · Server-Sent Events · Zod · TanStack Query · React Hook Form · Tailwind CSS · Storybook · Playwright · Nx monorepo · Docker · GitHub Actions**.

---

## Features

| Feature | How it works |
|---|---|
| **Import real trials** | **Import from ClinicalTrials.gov** searches the public US registry (API v2: condition, keywords or an NCT ID, recruiting status, 10 per page with "load more"). Picking a study shows how it will look in TrialMatch before anything is saved, then one click imports it, and patients can be matched against it right away. Imported trials link back to the registry and record when the registry last updated them |
| **Eligibility text → criteria** | The registry stores eligibility as free text. A parser turns it into numbered I1 / E1 criteria: headings, bullets and numbered lists, sub-bullets and wrapped lines, intro lines, escaped markdown, and multi-cohort studies (each criterion is prefixed with its cohort, e.g. "For healthy controls: …"). Ages in months become whole years, rounded so no eligible patient is filtered out; combined phases (Phase 1/2) and every registry status are kept. Anything the import had to interpret or shorten is listed as a warning in the preview. Tested against real registry text |
| **Resilient registry calls** | Every call has a timeout; a slow or failing registry returns **502** with a message a person can act on, and nothing is saved. Records are cached for 5 minutes (preview then import is one registry call), registry routes have their own rate limit, and a study can only be imported once (**409** with the existing trial's id, also when two people import it at the same moment) |
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
| **Component library** | **Storybook** documents the shared components (form field, tag input, conflict banner, pagination, status badge, match card) with their states. Every story is also a test: Vitest renders it, runs its interaction (`play` function) and checks it with axe, so adding a story adds a test |
| **Accessibility** | Labels tied to inputs, errors announced and linked with `aria-describedby`, live regions for progress, keyboard-only flows. Playwright runs axe (WCAG 2.1 AA) on every main page in a real browser; it caught a low-contrast label, which was fixed |
| **One-container hosting** | For hosting, one image runs everything: the API also serves the built React app (hashed assets cached for a year, `index.html` never cached, deep links handled), so there is one URL, no CORS, and the live event stream stays same-origin. Deployed on **Render** with a **Neon** PostgreSQL database from `render.yaml` |
| **Operations** | JSON request logs (pino) with a request id on every response (`X-Request-Id`, taken from the proxy when it sets one), no headers or tokens in logs; a health check that also checks the database (used by Docker, Render and uptime monitors); correct client addresses behind proxies for rate limits and logs (`TRUST_PROXY`) |
| **Production images** | Multi-stage Docker builds; the API runs as a non-root user with production dependencies only, and the web app is served by unprivileged nginx, which also proxies `/api` |

## Tech stack

- **Frontend:** React 19, TypeScript, React Router 7, TanStack Query 5, React Hook Form + Zod, Tailwind CSS 4, Vite
- **Backend:** NestJS 11, Drizzle ORM, PostgreSQL 17 (full-text search), Zod (`nestjs-zod`), OpenAPI/Swagger, JWT, Argon2, Helmet, rate limiting
- **AI and jobs:** Anthropic Claude API (forced tool use), BullMQ, Redis (queue + pub/sub), Server-Sent Events
- **Monorepo:** Nx 24 (project graph, affected commands, caching, module boundaries), npm workspaces
- **Testing:** Playwright + axe-core (end-to-end and accessibility, against the Docker stack), Jest + Supertest (API integration tests on a real PostgreSQL), Vitest + Testing Library + Mock Service Worker (React), Storybook stories as tests, Vitest (shared schemas)
- **Ops:** Docker, Docker Compose, nginx, GitHub Actions, Render, Neon (serverless PostgreSQL), GitHub Pages, pino structured logging

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
npx nx storybook web   # component library on http://localhost:6006
npx nx graph           # see the project graph

# End-to-end (real browser against the running stack)
docker compose up -d --build --wait
npx playwright install chromium   # once
npx nx e2e web-e2e                # E2E_BASE_URL=http://localhost:4200 to test the dev servers instead
```

| Tests | What they prove |
|---|---|
| **API integration** (`apps/api/src/**/*.spec.ts`) | The real Nest app (guards, validation, error filter, migrations) against PostgreSQL: sign-in, 401s, field errors, NCT uniqueness, search with a literal `%`, pagination, 409 conflicts, owner-only patients and match runs, no 500s for odd ids, candidate selection, the event stream, retries then a clear failure |
| **Matching engines** (`apps/api/src/app/matching/engines.spec.ts`) | Claude engine with a mocked client: forced tool use, every criterion sent, skipped criteria filled in as unknown, malformed output and rate limits retryable, a bad key not, text escaped. Rule-based engine: "Type 1" vs "Type 2", negations |
| **React** (`apps/web/src/**/*.spec.tsx`) | Whole pages rendered with a mocked API (Mock Service Worker): sign-in redirects back, validation from the shared schemas, criteria reordering, field-only PATCH with the version, the 409 banner, sign-out on an expired token, a match run followed over an authenticated event stream to its per-criterion results |
| **End-to-end** (`apps/web-e2e`) | Chromium against the production images: sign-in and return, creating and editing a trial with reordered criteria, URL filters surviving a reload, two users and the conflict banner, adding a patient and matching it over the live event stream, privacy between users, keyboard-only sign-in, and axe scans of every main page |
| **Stories** (`apps/web/src/**/*.stories.tsx`) | Each component state renders, its interaction plays out, and axe finds no accessibility problems |
| **Shared** (`libs/shared`) | The Zod rules (email normalisation, defaults, the age-range rule, pseudonyms) and the eligibility decision rule |

CI (`.github/workflows/ci.yml`): formatting, then lint + typecheck + tests + builds + the Storybook build (only the affected projects on pull requests), a check that migrations match the schema, a job that builds the Compose images, starts the stack (PostgreSQL, Redis, the API with its worker, nginx), smoke-tests it and runs the Playwright suite against it, and a job that builds the single hosting image and smoke-tests it the way Render runs it.

## Deploying (free)

The hosted version uses the single-container `Dockerfile` (API + React app, matching in-process) on Render's free plan, with Neon's free PostgreSQL. Docker Compose keeps the full split setup (nginx, API, Redis worker).

1. **Database:** create a project at https://neon.tech and copy its connection string (it ends with `?sslmode=require`).
2. **App:** at https://render.com choose **New → Blueprint**, pick this repository, paste the connection string as `DATABASE_URL` (and optionally `ANTHROPIC_API_KEY`). `render.yaml` sets everything else; migrations and demo data run on first start.
3. **Storybook:** in the GitHub repository, **Settings → Pages → Source: GitHub Actions**. The `Storybook` workflow publishes it on every push to `main`.
4. **Uptime:** point a free monitor (e.g. UptimeRobot) at `https://<your-app>.onrender.com/api/health` every 5 minutes. It alerts you if the app or database is down, and keeps the free instance from sleeping.

Render redeploys automatically on every push to `main`. CI builds and smoke-tests the same image first (`image` job).

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
│   │       ├── registry/       ClinicalTrials.gov client, study → trial mapper, search / preview / import
│   │       ├── db/             Drizzle schema, migrations, seed data
│   │       ├── common/         Error filter (ApiError shape), Zod DTO helpers
│   │       └── setup.ts        Shared by main.ts and tests: Helmet, CORS, OpenAPI, migrations
│   ├── web/                    React app (+ .storybook)
│   │   └── src/
│   │       ├── features/       auth, trials, patients, matching, registry (pages, forms, TanStack Query hooks)
│   │       ├── components/     Layout, Field, TagInput, ConflictBanner, Pagination
│   │       ├── lib/            API client (incl. SSE over fetch), auth context, form helpers
│   │       └── testing/        Mock Service Worker setup and fixtures
│   └── web-e2e/                Playwright end-to-end and accessibility tests
├── Dockerfile                  Single-container image for hosting (API + React app)
├── render.yaml                 Render Blueprint (free plan) for the live demo
├── libs/shared/                Zod schemas, types and the eligibility rule, used by both apps
└── docker-compose.yml          db, redis, api, web
```

## Roadmap

- [x] **Week 1:** Nx monorepo · NestJS API (auth, trials, patients) · React app · shared Zod schemas · tests · Docker · CI
- [x] **Week 2:** AI eligibility matching with Claude (a verdict and reason per criterion) · BullMQ background jobs · live progress over Server-Sent Events · full-text candidate search
- [x] **Week 3:** Playwright end-to-end tests · Storybook component library (stories as tests) · accessibility checks (axe, WCAG 2.1 AA)
- [x] **Week 4:** Live demo on Render + Neon (single-container image) · Storybook on GitHub Pages · structured logging, request ids, health checks
- [x] **Week 5:** Import real trials from ClinicalTrials.gov (search, preview with warnings, one-click import) · eligibility-text parser · all registry phases and statuses
