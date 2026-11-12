# Movie Memory

A small full-stack app: sign in with Google, save your favorite movie, and get an AI-generated fun fact about it.

Built with **Next.js (App Router) · TypeScript · React · Tailwind CSS · PostgreSQL · Prisma · Auth.js (Google OAuth) · OpenAI API · Vitest**.

**Variant chosen: A — Backend-Focused (Caching & Correctness).**

---

## Contents

1. [Variant choice](#variant-choice)
2. [Setup](#setup)
3. [Environment variables](#environment-variables)
4. [Database migrations](#database-migrations)
5. [Running, testing, building](#running-testing-building)
6. [Architecture overview](#architecture-overview)
7. [Key tradeoffs](#key-tradeoffs)
8. [What I would improve with 2 more hours](#what-i-would-improve-with-2-more-hours)
9. [AI usage](#ai-usage)

---

## Variant choice

I chose **Variant A** because my professional background is in backend systems. I spent three years building Java/Spring Boot banking applications, where preventing duplicate operations and failing safely when a downstream service is unavailable are everyday concerns. Variant A's burst protection and failure fallback map directly onto those problems, so it let me show depth in concurrency reasoning and data correctness within the time limit.

I considered Variant B but prioritized going deep on one variant over covering more surface area.

---

## Setup

### Prerequisites

- **Node.js 20+** (developed on Node 24)
- **PostgreSQL** (developed on PostgreSQL 18; any recent version works)
- A **Google Cloud OAuth client** (Web application)
- An **OpenAI API key** with available credit

### 1. Install dependencies

```bash
git clone https://github.com/sid0825/movie-memory.git
cd movie-memory
npm install
```

### 2. Create a database

Any Postgres database works. For example, with Docker:

```bash
docker run --name movie-memory-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=movie_memory \
  -p 5432:5432 -d postgres:16
```

Or with an existing local Postgres:

```sql
CREATE DATABASE movie_memory;
```

### 3. Configure Google OAuth

In Google Cloud Console → **Google Auth Platform**:

1. Configure the consent screen (Audience: External). While the app is in Testing mode, add your Google account under **Test users**.
2. Create an **OAuth client** of type **Web application** with:
   - Authorized JavaScript origin: `http://localhost:3000`
   - Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`

### 4. Set environment variables

```bash
cp .env.example .env
```

Then fill in the values (see the next section).

### 5. Apply migrations and run

```bash
npx prisma migrate deploy
npm run dev
```

Open **http://localhost:3000** (use `localhost`, not a network IP, so it matches the OAuth redirect URI).

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string, e.g. `postgresql://postgres:postgres@localhost:5432/movie_memory?schema=public` |
| `AUTH_SECRET` | Yes | Secret used by Auth.js to sign/encrypt session data. Generate with `openssl rand -base64 32` |
| `AUTH_GOOGLE_ID` | Yes | Google OAuth client ID |
| `AUTH_GOOGLE_SECRET` | Yes | Google OAuth client secret |
| `OPENAI_API_KEY` | Yes | OpenAI API key (server-side only) |
| `OPENAI_MODEL` | No | Model used for fact generation. Defaults to `gpt-4o-mini` |

All secrets are read **only on the server**. None use the `NEXT_PUBLIC_` prefix, so none are sent to the browser. `.env` is git-ignored; `.env.example` lists the keys with empty values.

> When deploying (not needed locally), Auth.js also needs `AUTH_TRUST_HOST=true` or `AUTH_URL` set to the public URL, and the production callback URL must be added to the Google OAuth client.

---

## Database migrations

Migrations live in `prisma/migrations/` and are committed to the repo.

| Command | When to use |
|---|---|
| `npx prisma migrate deploy` | Apply existing migrations to a fresh database (reviewers, CI, production) |
| `npx prisma migrate dev` | During development, after changing `prisma/schema.prisma` |
| `npx prisma studio` | Browse the data in a local web UI |

`prisma.config.ts` loads `.env` via `dotenv`, so Prisma CLI commands pick up `DATABASE_URL` automatically.

---

## Running, testing, building

```bash
npm run dev     # development server at http://localhost:3000
npm test        # Vitest test suite (no database or network needed)
npm run lint    # ESLint
npm run build   # production build with full TypeScript check
```

The test suite runs entirely in memory (see [Testing](#testing)), so it needs no database, API key or network access.

---

## Architecture overview

### Request flow

```
Browser ──► Next.js server (App Router)
              │
              ├─ Server Components (pages)  ── auth() ──► Session table (Postgres)
              │     /, /onboarding, /dashboard
              │
              ├─ Server Actions             ── onboarding form, sign-in, sign-out
              │
              ├─ Route handler              ── /api/auth/[...nextauth] (Auth.js / Google OAuth)
              │
              └─ Fact service ──► FactRepository (Prisma ──► Postgres)
                              └─► FactGenerator (OpenAI API)
```

Every page that depends on the signed-in user is **dynamically rendered per request**. All authorization checks, database access and OpenAI calls run **on the server**; the browser only ever receives rendered HTML and a session cookie.

### Project structure

```
prisma/
  schema.prisma                  Data model
  migrations/                    Versioned SQL migrations
src/
  auth.ts                        Auth.js config (Google provider, Prisma adapter, database sessions)
  app/
    page.tsx                     Landing page + post-login routing
    onboarding/
      page.tsx                   Guards (logged out / already onboarded)
      onboarding-form.tsx        Client form (pending + error state)
      actions.ts                 Server Action: validate + save favorite movie
    dashboard/
      page.tsx                   Profile, favorite movie, logout
      fact-card.tsx              Wires real dependencies into the fact service
    api/auth/[...nextauth]/route.ts   Auth.js route handlers
  lib/
    prisma.ts                    Shared Prisma client (singleton)
    validation.ts                Zod schema for the movie title
    openai.ts                    FactGenerator implementation (OpenAI)
    fact-repository.ts           FactRepository interface + Prisma implementation
    facts.ts                     Fact service: cache window, lock, fallback
    facts.test.ts                Tests
    test-utils/in-memory-fact-repository.ts   In-memory FactRepository for tests
```

### Authentication and routing

- **Auth.js v5** with the **Google** provider and the **Prisma adapter**. Users, linked Google accounts and sessions are stored in Postgres.
- **Database session strategy:** the browser holds only a random session token in an HTTP-only cookie; the session lives in the `Session` table. Logging out deletes that row, so sessions are revoked server-side.
- **First-time vs returning users** is defined by data, not by a login counter: a user is onboarded once `favoriteMovie` is set. After Google sign-in, everyone returns to `/`, which routes to `/onboarding` or `/dashboard`. Keeping that decision in one place means it can't drift out of sync.
- Each protected page checks the session **on the server before rendering**: logged-out users are redirected to `/`; un-onboarded users can't reach `/dashboard`; onboarded users can't revisit `/onboarding`.

### Data model

| Model | Purpose |
|---|---|
| `User` | Google profile (name, email, image), `favoriteMovie`, and `factGenerationStartedAt` (the generation lock) |
| `MovieFact` | One row per generated fact: `userId`, `movie`, `fact`, `createdAt` |
| `Account`, `Session`, `VerificationToken` | Standard Auth.js adapter models |

Design decisions:

- **`favoriteMovie` lives on `User` and is nullable.** Each user has exactly one favorite movie, so a separate table would add a join with no benefit. `null` means "not onboarded yet".
- **`VarChar(100)` on movie columns** matches the server-side validation limit, so the database enforces the same rule (defense in depth).
- **`MovieFact` stores the movie title** so the cache is keyed by **user + movie** as required: a fresh fact about one movie is never served for another. Facts are appended, never overwritten, which preserves history and provides fallback data.
- **Index `(userId, movie, createdAt DESC)`** matches the hot query, "latest fact for this user and movie", exactly.
- **`onDelete: Cascade`** on user relations prevents orphaned rows.
- **`cuid()` IDs** are non-sequential and not guessable.

### Onboarding and validation

The onboarding form submits to a **Server Action** that:

1. Reads the user ID from the **session**, never from the form.
2. Validates the title with **Zod**: trimmed, 1–100 characters. HTML attributes (`required`, `maxLength`) are a convenience only; the server is the source of truth.
3. Saves with a conditional update (`WHERE id = ? AND favoriteMovie IS NULL`), which makes onboarding genuinely first-time only, even if the request is replayed.

### Fact generation (Variant A)

The logic is split into three layers so the business rules can be tested in isolation:

| Layer | File | Role |
|---|---|---|
| `FactGenerator` | `lib/openai.ts` | Turns a movie title into a fact (OpenAI in production, a fake in tests) |
| `FactRepository` | `lib/fact-repository.ts` | All database operations (Prisma in production, in-memory in tests) |
| Fact service | `lib/facts.ts` | Cache window, burst protection, failure fallback |

`getFactForUser(userId, { repo, generate, now })` runs this flow:

```
Get the user's movie
  └─ Latest fact for this user + movie is < 60s old? ──► return it   (fresh)
  └─ Try to claim the generation lock
        ├─ Lost (another request is generating) ──► previous fact (stale) or "generating"
        └─ Won:
             try     ─ re-check the cache (another request may have just finished)
                     ─ generate, store, return                     (generated)
             catch   ─ previous fact (stale) or a friendly message (unavailable)
             finally ─ release the lock
```

**1. 60-second cache window.** A fact is fresh when `now - createdAt < 60s` (strict, so a fact exactly 60 seconds old triggers regeneration). The clock is injected (`now`), so all time comparisons use one clock and tests can control time deterministically.

**2. Burst / idempotency protection — "generation in progress" flag.** `User.factGenerationStartedAt` acts as a lock, claimed with a **single atomic conditional UPDATE**:

```sql
UPDATE "User" SET "factGenerationStartedAt" = :now
WHERE id = :userId
  AND ("factGenerationStartedAt" IS NULL OR "factGenerationStartedAt" < :now - 30s)
```

Postgres serializes concurrent updates to the same row, so exactly one request sees a row count of 1. Supporting details:

- **Expiry:** a lock older than 30 seconds is treated as abandoned, so a crashed request can't block a user indefinitely. (OpenAI calls time out after 10 seconds with one retry, so healthy requests finish well within that.)
- **Ownership:** release only clears the lock if it still holds this request's timestamp, so a slow request can't clear a lock another request has since claimed.
- **Double-checked locking:** after winning the lock, the service re-checks the cache. Without this, a request that acquired the lock just after another one finished would generate a duplicate.
- **Losers don't wait:** concurrent requests return the previous fact (or a "generating" message for a brand-new user) instead of blocking.

**3. Failure handling.** Timeouts, API errors and empty responses all take the same path: the real error is logged server-side, and the user sees the most recent stored fact (even if older than 60 seconds) or a friendly message if none exists. Raw errors are never shown. The lock is always released in `finally`.

**4. Safe OpenAI integration.**

- The API key is read only in server code; the client is created per call so a missing key fails one request rather than the whole module.
- 10-second timeout, one retry, and a response length cap (`max_completion_tokens`) to bound latency and cost.
- The system prompt asks for short, accurate trivia and to say so if the movie isn't recognized, rather than inventing facts.
- The model is configurable via `OPENAI_MODEL`.
- Generated text is rendered as plain text by React, so it can't inject HTML.

On the dashboard, the fact is rendered inside a React `Suspense` boundary: the profile and movie render immediately, and the fact streams in when ready, with a loading message in the meantime.

### Security and authorization

- **Identity always comes from the server session.** No endpoint, action or page accepts a user ID from the client, and every fact query is scoped to the session's user ID. This prevents insecure direct object references by construction.
- **Server-side validation** of all user input (Zod + database constraints).
- **Secrets stay on the server** (no `NEXT_PUBLIC_` variables; `.env` git-ignored).
- **Missing Google data is handled gracefully:** no name falls back to the email; no photo shows an initial avatar.
- Google profile images are loaded via `next/image` with an explicit allow-list (`lh3.googleusercontent.com`).

### Testing

`src/lib/facts.test.ts` tests the fact service with an injected clock, a mock generator (`vi.fn`) and an in-memory `FactRepository` that follows the same contract as the Prisma implementation:

| Area | Tests |
|---|---|
| 60-second cache | Generates when empty · reuses at 59s without calling OpenAI · regenerates at exactly 60s and keeps history · never reuses a fact for a different movie |
| Authorization | A user never receives another user's fact, even a fresh one for the same movie |
| Burst protection | Three concurrent requests → one OpenAI call, one stored fact |
| Failure handling | Falls back to the latest fact · friendly message with no raw error leaked · lock released after failure so a retry succeeds |

#### Integration tests (real Postgres)

`src/lib/fact-repository.integration.test.ts` runs the generation lock against a real Postgres database. It fires 20 concurrent lock attempts from 5 independent Prisma clients (separate connection pools, like separate app servers) and asserts exactly one wins, checks lock expiry and ownership, and runs the full fact service concurrently, asserting a single generation and a single stored fact. Replacing the atomic `UPDATE` with a naive read-then-write makes these tests fail (4 requests acquired the lock and 5 generated), confirming they detect the race.

They are skipped unless `TEST_DATABASE_URL` points to a dedicated, disposable database:

```bash
export TEST_DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/movie_memory_test?schema=public"
DATABASE_URL="$TEST_DATABASE_URL" npx prisma migrate deploy
npx vitest run src/lib/fact-repository.integration.test.ts
```

---

## Key tradeoffs

- **Generation flag over the other burst-protection options.** An in-memory lock only works within a single server process. A unique constraint per 60-second window uses fixed time buckets, which doesn't match the sliding window in the requirements (a fact from 3:00:58 and one from 3:01:02 fall in different buckets). A transaction guard (`SELECT … FOR UPDATE`) is correct but holds a transaction and a pooled connection open for the whole OpenAI call. The flag gives a database-level guarantee across instances without long-running transactions.
- **Per-user lock rather than per user + movie.** Equivalent here because a user has exactly one favorite movie at a time; supporting multiple movies would mean moving the lock into its own table keyed by user and movie.
- **Concurrent requests return immediately** with the previous fact or a "generating" message rather than waiting for the winner. Simpler and avoids holding requests open; the cost is that a brand-new user's second tab must refresh.
- **Stale facts on failure.** Showing an older fact during an outage is a better experience than an error, at the cost of occasionally serving a fact older than 60 seconds.
- **Facts are generated during page render** (a GET with a side effect) rather than through a separate API call. This keeps the app simple and server-only; the lock and cache make repeated renders safe.
- **Database sessions over JWT sessions.** Sessions can be revoked server-side on logout, at the cost of one session lookup per request.
- **Onboarding is first-time only**, as specified; there is no edit flow (that belongs to Variant B).
- **Tests use an in-memory repository.** Fast and deterministic, but they don't exercise the real SQL; see the improvements below.
- **Prisma 6 and the classic `prisma-client-js` generator**, pinned for stability and compatibility with the Auth.js Prisma adapter, instead of moving to a newer major version mid-project.
- **Next.js 16 Cache Components disabled.** Every page depends on the signed-in user, so standard request-time rendering is simpler and correct for this app.

---

## What I would improve with 2 more hours

1. **Integration tests against a real Postgres database**, to verify the atomic `UPDATE` lock under genuine concurrency, plus end-to-end tests (e.g. Playwright) for the sign-in and redirect flows.
2. **Use the database clock (`now()`) for the lock** instead of application server time, so the 30-second expiry is immune to clock drift between multiple app servers.
3. **Stop persisting unused OAuth tokens.** The Prisma adapter stores Google access and ID tokens by default; the app never uses them, so I would avoid storing them (or encrypt them).
4. **Allow editing the favorite movie.** The cache is already keyed by user + movie, so a changed movie would invalidate cached facts automatically with no changes to the fact service.
5. **Auto-refresh the "generating" state** with light client polling instead of asking the user to refresh.
6. **Per-user rate limiting and cost guardrails** on OpenAI calls, plus structured logging and metrics for generation latency and failures.
7. **Prompt hardening** for the user-supplied movie title (it is currently interpolated into the prompt; the impact is limited to that user's own fact, and output is escaped when rendered).

---

## AI usage

- I used **Claude (Anthropic)** as a pair programmer and tutor throughout the project, since parts of this stack (TypeScript, Next.js App Router, Prisma, Auth.js) were newer to me than my primary Java/Spring Boot background.
- **Understanding and planning:** used it to break down the assignment, map requirements to a plan, and explain unfamiliar concepts by comparison to Spring (e.g. Server Components vs controllers, Prisma vs JPA, Auth.js sessions vs `HttpSession`).
- **Design discussion:** compared the four burst-protection approaches and their tradeoffs before choosing the atomic generation flag, and discussed edge cases such as lock expiry, lock ownership and double-checked locking.
- **Code generation:** AI drafted most of the initial code (schema, auth setup, pages, fact service, tests). I reviewed every file, asked for line-by-line explanations of anything I didn't understand, and verified behavior by running the app, inspecting the database in Prisma Studio, and running the tests, lint and production build.
- **Debugging:** used it to diagnose environment and setup issues (a Postgres locale-provider mismatch in pgAdmin, a Vitest peer-dependency conflict, and Next.js 16 Cache Components errors with per-request auth).
- **Writing:** used it to help draft this README, which I edited to reflect my own understanding and decisions.
