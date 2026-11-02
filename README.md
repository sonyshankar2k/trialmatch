# TrialMatch

**Match patients to clinical trials.** Research coordinators keep a catalog of clinical trials with their eligibility criteria and a private list of de-identified patient profiles. Week 2 adds AI matching: Claude reads a patient's profile and checks it against each trial's inclusion and exclusion criteria, with a reason for every criterion.

Built with **React 19 · TypeScript · NestJS · PostgreSQL · Drizzle ORM · Zod · TanStack Query · React Hook Form · Tailwind CSS · Nx monorepo · Docker · GitHub Actions**.

---

## Features

| Feature                             | How it works                                                                                                                                                                                                                                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **One schema for both apps**        | Request validation lives in `libs/shared` as Zod schemas. The NestJS API validates requests with them (via `nestjs-zod`, which also generates the OpenAPI docs), and the React forms validate with the same schemas through React Hook Form. Change a field once and both apps fail to compile until they are updated |
| **Nx monorepo**                     | `apps/web` (React + Vite), `apps/api` (NestJS + webpack), `libs/shared`. Module-boundary lint rules allow the web app and the API to share code only through `libs/shared`; CI checks only the projects a pull request affects                                                                                        |
| **Authentication**                  | Register / sign in with Argon2-hashed passwords and signed JWTs. A global guard protects every route unless marked `@Public()`; the login endpoint is rate-limited and gives the same answer (and the same timing) for an unknown email and a wrong password                                                          |
| **Trials**                          | Search across title, condition, NCT ID and sponsor; filter by phase and status; paginate. Filters live in the URL, so a filtered list can be bookmarked and shared                                                                                                                                                    |
| **Eligibility criteria editor**     | Add, reorder and remove inclusion / exclusion criteria (React Hook Form field arrays). The API numbers them I1, I2… / E1, E2…                                                                                                                                                                                         |
| **Private, de-identified patients** | A pseudonym (validated so it can't look like a real name), age, sex, conditions, medications and clinical notes. Every query is scoped to the owner: another user's patient id returns 404, exactly like one that doesn't exist                                                                                       |
| **Optimistic concurrency**          | Every record has a `version`. Saves send only the changed fields plus the version they read; a stale save gets **409** with the current record, and the UI offers **Load their version** or **Save mine anyway**                                                                                                      |
| **Consistent errors**               | Every error has one shape (`ApiError`). Validation errors carry field-level messages that the forms show on the right field, including server-only checks such as a duplicate NCT ID                                                                                                                                  |
| **Migrations**                      | Drizzle generates SQL migrations from the schema; the API applies them at startup under a PostgreSQL advisory lock, so two replicas never migrate at once. CI fails if the schema changes without a migration                                                                                                         |
| **Production images**               | Multi-stage Docker builds; the API runs as a non-root user with production dependencies only, and the web app is served by unprivileged nginx, which also proxies `/api`                                                                                                                                              |

## Tech stack

- **Frontend:** React 19, TypeScript, React Router 7, TanStack Query 5, React Hook Form + Zod, Tailwind CSS 4, Vite
- **Backend:** NestJS 11, Drizzle ORM, PostgreSQL 17, Zod (`nestjs-zod`), OpenAPI/Swagger, JWT, Argon2, Helmet, rate limiting
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

**Try it:** open the same trial as Alice in one window and as Bob in a private window. Save a change as Alice, then save as Bob: Bob sees the conflict banner and chooses what happens.

## Development setup

Needs Node.js 22.12+ and PostgreSQL (or just the `db` service: `docker compose up -d db`).

```bash
npm install
npm run start:api      # http://localhost:3000/api  (applies migrations, seeds demo data)
npm run start:web      # http://localhost:4200      (proxies /api to the API)
```

Change the database schema in `apps/api/src/app/db/schema.ts`, then run `npm run db:generate` and commit the new migration.

## Tests

```bash
npm test               # all projects
npx nx test api        # API integration tests (needs PostgreSQL: TEST_DATABASE_URL, default trialmatch_test on localhost)
npx nx test web        # React component tests
npm run lint           # ESLint (with module boundaries) + TypeScript
npx nx graph           # see the project graph
```

| Tests                                             | What they prove                                                                                                                                                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **API integration** (`apps/api/src/**/*.spec.ts`) | The real Nest app (guards, validation, error filter, migrations) against PostgreSQL: sign-in, 401s, field errors, NCT uniqueness, search with literal `%`, pagination, 409 conflicts, owner-only patients, no 500s for odd ids |
| **React** (`apps/web/src/**/*.spec.tsx`)          | Whole pages rendered with a mocked API (Mock Service Worker): sign-in redirects back, validation from the shared schemas, criteria reordering, field-only PATCH with the version, the 409 banner, sign-out on an expired token |
| **Shared** (`libs/shared`)                        | The Zod rules themselves: email normalisation, defaults, the age-range rule on create and update, pseudonyms                                                                                                                   |

CI (`.github/workflows/ci.yml`): formatting, then lint + typecheck + tests + builds (only the affected projects on pull requests), a check that migrations match the schema, and a job that builds the production images, starts the stack and checks it through nginx.

## Project structure

```
trialmatch/
├── apps/
│   ├── api/                    NestJS API
│   │   └── src/app/
│   │       ├── auth/           Register, login, JWT guard, @Public(), @CurrentUser()
│   │       ├── trials/         Trials + criteria (search, filters, 409s)
│   │       ├── patients/       Owner-scoped patient profiles
│   │       ├── db/             Drizzle schema, migrations, seed data
│   │       ├── common/         Error filter (ApiError shape), Zod DTO helpers
│   │       └── setup.ts        Shared by main.ts and tests: Helmet, CORS, OpenAPI, migrations
│   └── web/                    React app
│       └── src/
│           ├── features/       auth, trials, patients (pages, forms, TanStack Query hooks)
│           ├── components/     Layout, Field, TagInput, ConflictBanner, Pagination
│           ├── lib/            API client, auth context, form helpers
│           └── testing/        Mock Service Worker setup and fixtures
├── libs/shared/                Zod schemas + TypeScript types used by both apps
└── docker-compose.yml          db, api, web
```

## Roadmap

- [x] **Week 1:** Nx monorepo · NestJS API (auth, trials, patients) · React app · shared Zod schemas · tests · Docker · CI
- [ ] **Week 2:** AI eligibility matching with Claude (a verdict and reason per criterion) · semantic trial search (pgvector)
- [ ] **Week 3:** Live updates · Playwright end-to-end tests · Storybook component library
- [ ] **Week 4:** Live deployment · monitoring
