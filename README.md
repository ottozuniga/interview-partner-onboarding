# Partner self-service onboarding

A resumable three-step onboarding wizard — **Details → Validate integration → Review and go live** —
backed by a NestJS REST API and PostgreSQL, with a mock external Provider the partner must validate
against before going live.

The interesting parts are not the wizard. They are three properties, each of which has tests that
fail if you remove the mechanism protecting it:

1. **Resume.** All state lives on the server, so reload, incognito, and a full server restart land the
   partner on the correct step with prior input intact.
2. **Idempotent, retry-safe validation.** Double-clicking *Validate* fires one Provider call. A
   transient 503 cannot corrupt state.
3. **Consistent go-live.** All-or-nothing, with no half-committed state if something fails midway.

---

## Running it locally

### Prerequisites

- **Node 20+** (developed on 26 — see [the note below](#a-note-on-node-26))
- **PostgreSQL 14+** running locally. No Docker needed.
- **pnpm 10+** (`npm i -g pnpm`)

### Setup

```bash
pnpm install

# Create the two databases. On a stock Homebrew Postgres install your macOS
# username is a superuser with trust auth, so no password is involved.
createdb onboarding_dev
createdb onboarding_test

# Point the app at them.
cp apps/api/.env.example apps/api/.env
# then edit DATABASE_URL / TEST_DATABASE_URL if your role is not `postgres`,
# e.g. postgresql://$(whoami)@localhost:5432/onboarding_dev?schema=public

pnpm db:setup      # runs migrations, then seeds the single partner
pnpm dev           # API on :3000, web on :5173
```

Open <http://localhost:5173>.

### Commands

| Command | Does |
|---|---|
| `pnpm dev` | Runs API and web together |
| `pnpm test` | **Runs the test suite** (see [Tests](#tests)) |
| `pnpm build` | Builds all three packages |
| `pnpm typecheck` | Typechecks all three packages |
| `pnpm db:setup` | Migrates then seeds — the one-shot first-run command |
| `pnpm db:migrate` | Applies migrations to the dev database |
| `pnpm db:seed` | Seeds the hardcoded partner (idempotent) |
| `pnpm db:reset` | Drops and rebuilds the dev database |
| `pnpm db:studio` | Opens Prisma Studio to inspect rows |

### Environment variables

All live in `apps/api/.env` (see `.env.example`). Validated with Zod at boot, so a missing or
malformed value fails immediately rather than surfacing as a confusing runtime error.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | Dev database. Required. |
| `TEST_DATABASE_URL` | — | Test database. Must differ from `DATABASE_URL` and contain "test". |
| `PORT` | `3000` | API port |
| `WEB_ORIGIN` | `http://localhost:5173` | CORS origin |
| `PARTNER_NAME` | `CompanyABC` | The single hardcoded partner |
| `PROVIDER_TIMEOUT_MS` | `5000` | How long to wait on the Provider before calling it transient |
| `PROVIDER_LATENCY_MS` | `1200` | Artificial latency, so the running state is visible in the UI |
| `ATTEMPT_STALE_GRACE_MS` | `15000` | Added to the timeout before an abandoned attempt is written off |

---

## Driving the Provider

The mock lives in the same NestJS app and is exposed at `POST /provider/validate`, matching the
contract exactly. **The outcome is chosen by `accountId`:**

| `accountId` | Outcome |
|---|---|
| `acct_valid` | `200 {status: "valid", items: [...]}` — 3 items |
| `acct_partial` | `200 {status: "partial", items, warnings}` — 2 items, 2 warnings |
| `acct_invalid` | `200 {status: "invalid", reason}` |
| `acct_unavailable` | `503` |
| `acct_timeout` | Never answers in time — the client's deadline fires |
| `acct_flaky` | `503` on the first call, valid on every call after — demonstrates safe retry |
| *anything else* | Behaves like `acct_valid`, so the happy path is the default rather than a special case |

Any non-empty `apiKey` works; it only affects the credentials fingerprint.

You can call the Provider directly:

```bash
curl -s localhost:3000/provider/validate \
  -H 'content-type: application/json' \
  -d '{"accountId":"acct_partial","apiKey":"sk_test_1234"}' | jq
```

### Walking the scenarios

The live screen has a **"Start over (demo)"** button that abandons the session so you can run through
another scenario without touching the database. It is a demo affordance, not a product feature — real
onboarding would gate it behind an operator role, and there is no auth here to hang that off.

---

## How it works

```
apps/web (React + Vite)              apps/api (NestJS)
  │                                    ├── OnboardingModule
  │  GET /api/onboarding/session       │     ├── SessionService     resume, details, step derivation
  ├─────────────── polls ─────────────►│     ├── ValidationService  attempt lifecycle, idempotency
  │                                    │     └── GoLiveService      the atomic transition
  │                                    ├── ProviderMockModule   (behind a ProviderClient interface)
  └───────────── shares ───────────┐   └── PrismaModule
                                   ▼
                    packages/contracts (Zod schemas)  ─►  PostgreSQL
```

**One read drives everything.** `GET /api/onboarding/session` returns a complete `SessionView`, and
the React app is a pure function of it. The client stores no wizard state at all — which is why
incognito and server-restart resume work without any special handling.

### API

| Endpoint | Purpose |
|---|---|
| `GET /api/onboarding/session` | The resume payload. Creates a session if none exists. |
| `PUT /api/onboarding/session/details` | Step 1 |
| `POST /api/onboarding/session/validate` | Step 2. `202`, idempotent. |
| `POST /api/onboarding/session/complete` | Step 3. Atomic, idempotent. |
| `POST /api/onboarding/session/reset` | Demo helper |
| `POST /provider/validate` | The mock Provider |
| `GET /api/health` | Liveness plus a database check |

### 1. Resume — the step is derived, never stored

There is no `currentStep` column. Storing one invites drift between what the row says and what the
data actually supports. Instead a pure function computes it:

| State | Step |
|---|---|
| Completed | **Live** |
| No credentials | **1 — Details** |
| Credentials, but no usable result for *those* credentials | **2 — Validate** |
| A `VALID` or `PARTIAL` result for the current credentials | **3 — Review** |

The key definition is the **decisive attempt**: the most recent attempt whose credentials fingerprint
matches the session's current one and whose status is `VALID`, `PARTIAL`, or `INVALID`. Two behaviours
fall out of it rather than needing their own logic:

- **Editing credentials invalidates a prior result.** New credentials produce a new fingerprint, so
  older attempts simply stop matching. No cache-busting code exists.
- **A transient failure cannot demote you.** `TRANSIENT_FAILURE` is excluded from decisive, so a 503
  on a retry surfaces a notice while the earlier good result stays intact. An `INVALID` *is* decisive
  and does revoke it — the Provider actively rejected those credentials, which is a different thing
  from not being able to reach it.

### 2. Idempotent validation — the database is the mutex

A hand-written partial unique index (Prisma's schema language cannot express it) permits at most one
running attempt per session:

```sql
CREATE UNIQUE INDEX one_running_attempt_per_session
  ON "validation_attempts" ("sessionId") WHERE "status" = 'RUNNING';
```

A concurrent second `POST` loses the insert race, catches the unique violation, and is handed the
winner's attempt instead of calling the Provider again.

**That alone is not enough**, and the test that proved it is worth calling out. With a fast Provider,
the first attempt settles *before* the second click arrives — the index has nothing to catch, and you
get two Provider calls. The in-flight index makes double-click safety depend on the Provider being
slower than the gap between clicks, which is a race you usually win, not a guarantee.

So an existing *answer* for the same credentials is reused outright. A transient failure is not an
answer, so a retry genuinely re-calls; changing credentials re-calls; and re-checking unchanged,
already-answered credentials is a deliberate act that must pass `{"revalidate": true}`.

Validation runs in the background and the endpoint returns `202` immediately, so a slow Provider
cannot hold the request open. Two further guarantees:

- **Abandoned attempts self-heal.** An attempt still running past any plausible deadline is written
  off on the next read. No cron, no background worker to supervise — a process killed mid-call
  recovers on the next request.
- **A late reply cannot resurrect it.** Outcomes are written conditionally on the attempt still being
  `RUNNING`, so a Provider response that arrives after the attempt was given up on is discarded.

### 3. Go-live — one transaction, conditional update

The session transition and the partner going live happen in a single transaction. A partner marked
live against an incomplete session, or a completed session whose partner is not live, are states this
system must never be in.

Readiness is re-checked *inside* the transaction against freshly read rows, because the pre-check ran
against a snapshot a concurrent request could already have invalidated. The update is conditional on
both the status and the version the decision was made against; under `READ COMMITTED` a competing
transaction blocks and then re-tests that predicate against the committed row, so exactly one can
match. The loser returns the completed state as a normal `200` — resubmitting is not an error.

An unexpected failure answers **503, not 500**: the transaction rolled back, so retrying is guaranteed
safe, and the partner is told so rather than left wondering whether they are half-live.

---

## Tests

```bash
pnpm test
```

87 tests across 6 suites, run against a **real PostgreSQL test database** provisioned by the real
migration files. Roughly 4 seconds.

Using real Postgres rather than a mock is deliberate: the partial unique indexes *are* the concurrency
guarantees, so a mocked database would test nothing that matters. Concurrency is exercised with
genuine `Promise.all` races, and each guarantee also has a deterministic companion test asserting
Postgres itself rejects the second write — because a race cannot be forced to occur on every run.

Three guards stop the suite from touching your dev database: it refuses a test URL that equals
`DATABASE_URL` or does not contain "test", and the truncation helper throws unless `NODE_ENV=test`.
Set `TEST_LOGS=1` to see application logs, which are silenced by default because several tests
deliberately provoke failures.

**The two consistency guarantees were mutation-tested** — removing the version guard fails the
concurrency test, and moving the partner update outside the transaction fails the rollback test. A
passing suite and a suite that asserts nothing look identical from the outside; this is the difference.

---

## Design decisions and trade-offs

**Contracts as a shared package.** Zod schemas in `packages/contracts` are the single source of truth:
the API validates requests with them and the web app parses *responses* with the same schemas, so
drift fails loudly instead of mis-rendering. The cost is a build step between the packages.

**Guarantees in Postgres, not application code.** The two partial unique indexes are the concurrency
primitives. Enforcing them in the database means a race cannot slip between a `SELECT` and an
`INSERT`; the cost is hand-written SQL in the migration that `prisma db pull` will not round-trip, so
the schema and the migration must be kept in step deliberately.

**Async validation with polling.** Returning `202` and polling keeps a slow Provider from holding a
request open, and makes "reload mid-validation" work properly. The cost is more moving parts than a
synchronous call, and the reaper needed to handle a process dying mid-flight.

**Lazy reaping instead of a background job.** Abandoned attempts are written off on read. No worker
to deploy or supervise, and correct in a multi-instance deployment. The cost is that an abandoned
attempt is only cleaned up when someone next looks at that session — fine here, because the only
party who cares is the partner who is about to retry.

**Items stored as JSON on the attempt.** Items are never queried or mutated independently of the
attempt that produced them, so a relational table would add a "keep the materialized set in sync"
invariant for no benefit. Because attempts are immutable once terminal, the snapshot is also the audit
trail. The trade-off: reporting across partners' items would want a real table.

**Derived step over stored step.** A pure function of the data, exhaustively unit-tested without a
database. It cannot drift. The cost is that the rule must be re-derived on every read, which is
trivial at this scale.

**The single hardcoded partner is resolved server-side.** With no auth in scope, `GET /session` maps
to the one seeded partner. Reads are pure reads; the partner row is only created on first-ever use, so
a forgotten `db:seed` is not a confusing 500.

---

## Deliberately deferred

**The API key is stored in plaintext.** This is the most significant deferral. It never leaves the
server — the API only ever returns a masked form (`••••3210`) — but it sits unencrypted in Postgres.
Doing it properly means envelope encryption with a KMS-managed key, which is infrastructure this
exercise does not have. The seam is ready: the key is written and read in exactly one place
(`SessionService`), and the fingerprint used for invalidation is already a hash rather than the key.

**No auth.** Per the brief. Everything resolves to one seeded partner. The reset endpoint would need
an operator role in reality.

**No frontend tests.** Agreed as out of scope; the wizard was verified manually in a browser, including
killing the API mid-flow to confirm restart resume. The riskiest client logic — deciding when a retry
needs `revalidate` — is the piece I would most want covered first.

**Attempts are executed in the process that received the request.** Correct and safe across multiple
instances, because the index serialises starts and the reaper recovers orphans. But recovery from a
crashed instance waits for the stale threshold rather than being picked up immediately.

**No linter or formatter.** TypeScript runs in strict mode and `pnpm typecheck` covers all three
packages, but there is no ESLint or Biome config. I removed the root `lint` script rather than leave
one that silently passes without checking anything.

**No rate limiting, no observability beyond structured logs**, and no pagination on items (the
Provider returns a handful).

**Prisma's `package.json#prisma` config is deprecated** ahead of Prisma 7 and logs a warning on `db:*`
commands. Migrating to `prisma.config.ts` changes how `.env` is loaded; not worth destabilising env
handling for a cosmetic warning.

---

## With another day

1. **Encrypt the API key at rest**, since it is the one deferral with real consequences.
2. **A Playwright end-to-end test** covering reload-mid-validation and the incognito resume — the
   properties currently proven by hand.
3. **Frontend unit tests** for step resolution and the revalidate decision.
4. **Structured logging with a correlation id** threaded from request through the background attempt,
   so a Provider call can be traced end to end.
5. **Surface attempt history in the UI.** It is already stored and immutable; showing "3 attempts, last
   failed 2 minutes ago" would cost little and answer the first question a confused partner asks.
6. **Replace the mock with a real HTTP client.** The `ProviderClient` interface is the only seam that
   needs to change; circuit-breaking and retry-with-backoff would belong behind it.

---

## A note on Node 26

Developed against Node 26 with Prisma 6.19, which works. The lockfile and `engines` allow Node 20+.
If Prisma's query engine ever objects to a very new Node release, pin Node 22 LTS — nothing in the
application depends on a recent runtime feature.
