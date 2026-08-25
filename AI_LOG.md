# AI Log

## Booking State Machine

- Delegated to Copilot: inspect the existing Prisma schema and implement the
  focused booking lifecycle state machine and Jest unit tests.
- Reviewed: the existing `BookingStatus` enum, `AuditEvent` model, transaction
  boundary, terminal-state behavior, and all required valid/invalid transitions.
- Review outcome: the initial scaffold had no state-machine behavior, so this
  task added a pure central transition map plus a Prisma transaction service.
  No incorrect implementation was retained, no controller or scattered direct
  status mutation was added, and the architecture/schema were not changed.

## Authentication and Tenant Isolation

- Delegated to Copilot: inspect the existing schema and add the focused JWT
  authentication, centralized role/venue policies, resource reads, and required
  cross-venue API tests.
- Reviewed: role assignments are loaded from Prisma after token verification;
  venue IDs in requests are never treated as authorization evidence. Booking
  ownership and the target room's venue are checked server-side.
- Review outcome: no schema or architecture change was necessary. Resource
  controllers remain thin and delegate access decisions to shared policies;
  no frontend-only or process-local authorization was introduced.
- Correction recorded: an initial controller version used a nested Prisma
  selection and un-narrowed Express route parameters, which failed strict
  compilation. It was replaced with explicit parameter validation and a direct
  room lookup for the booking's venue before authorization.

## Room Availability and Search

- Delegated to Copilot: implement the authenticated cross-venue room search,
  PostgreSQL interval query, filter validation, and focused integration tests.
- Initial implementation: the query used Prisma `$queryRaw`, the existing
  `protected_slot` GiST index, active booking states, and JSONB containment for
  all requested amenities.
- Review outcome: confirmed that availability stays in PostgreSQL and does not
  load bookings into Node. Added real Neon-backed fixtures and tests for every
  blocking/non-blocking status, turnaround boundaries, combined filters, and
  cross-venue results. No benchmark numbers were fabricated.
- Index decision: reused the existing active-room GiST index on
  `bookings.protected_slot`; no broad or redundant indexes were added.

## Booking Holds

- Delegated to Copilot: implement the authenticated atomic hold endpoint for
  rooms and equipment, including validation, pricing, TTL, reservations, and
  database-backed conflict handling.
- Initial implementation: room holds store a protected range expanded by 15
  minutes on both sides; equipment holds lock inventory rows and sweep active
  reservation intervals inside a serializable Prisma transaction.
- Correction recorded: the first availability adjustment expanded both the
  stored protected range and the requested search range, which would require a
  30-minute gap. It was corrected so availability compares the raw requested
  interval against the already-expanded protected range.

## Hold Concurrency

- Delegated to Copilot: implement the room/equipment hold transaction and a
  runnable three-replica API concurrency proof.
- Review outcome: room conflicts are left to the PostgreSQL exclusion
  constraint, equipment requests lock sorted inventory rows with `FOR UPDATE`,
  and all writes share one serializable Prisma transaction. A concurrency test
  using an API base URL was added without claiming results that were not run.
- Test correction: the initial turnaround fixture used a 15-minute start that
  violated the separate 30-minute booking-granularity rule; it now uses the
  next valid half-hour boundary.

## Payment and Paygate

- Delegated to Copilot: implement the mock Paygate charge/refund endpoints,
  HMAC webhook path, payment start flow, durable idempotency, duplicate
  delivery handling, and late-expiry refund foundation.
- Initial implementation: provider and Atrium records use unique database
  idempotency/provider keys; webhook processing locks payment rows before
  applying the centralized booking transition.
- Corrections recorded: an attempted Paygate-to-payment one-to-one relation was
  removed because unknown charges must be persisted before a local payment
  exists. The old payment-event foreign key was removed in a migration for the
  same reason. A route-order bug that authenticated the webhook was corrected,
  and an expiry path was changed from an illegal direct `PENDING_PAYMENT ->
  REFUNDED` jump to `PENDING_PAYMENT -> EXPIRED -> REFUNDED`.
- Review outcome: provider failures now leave ambiguous payment attempts
  `PROCESSING`/retryable, rather than incorrectly transitioning bookings to
  `FAILED`; retrying the same idempotency key can therefore recover without a
  duplicate charge. Raw webhook bytes, database row locks, and unique
  delivery/business keys remain authoritative.

## Remaining Tier 1 Completion

- Delegated to Copilot: audit the repository against all remaining Tier 1
  requirements and implement cancellation, reconciliation, venue reporting,
  request correlation, dependency health, seeding, and CI where absent.
- Reviewed: existing routes, Prisma schema/migrations, Paygate flow, audit/state
  machine, tests, README, Docker/CI presence, and deployment artifacts.
- Corrections recorded: cancellation initially used a fixed 24-hour assumption
  and was changed to derive the booking interval and policy snapshot. Health
  initially returned success without a Paygate dependency check and now checks
  both persistence dependencies. Unknown-charge handling required preserving
  its migration without a provider foreign key.
- Operational limitation at that point in the build: no public deployment or
  full-profile benchmark had yet been claimed because no hosting/load-test
  environment was configured. These were verified later and recorded in the
  final verification entry below.
- Test issues discovered: remote Neon lock contention once exceeded the
  default interactive transaction timeout, so webhook processing now retries
  only transient Prisma transaction errors. Test cleanup also had to include
  unknown provider-event fixtures. These changes preserve database-level
  idempotency rather than hiding concurrency failures with mocks.

## Frontend Tier 1 UI

- Delegated to Cursor agent: inspect real backend contracts and implement a
  React + TypeScript + Tailwind frontend for the Tier 1 reviewer flow.
- Discovery: the backend had JWT authentication middleware but no login/me
  endpoints, booking detail responses were too sparse for checkout/detail UI,
  and there were no list-bookings or venue-equipment read endpoints. Room,
  equipment, pricing, and policy mutation APIs were also absent.
- Override: added only the minimal read/auth endpoints required for the UI
  (`POST /api/auth/login`, `GET /api/auth/me`, `GET /api/bookings`, enriched
  booking detail after authorization, `GET /api/venues/:venueId/equipment`)
  without changing concurrency, Paygate, Prisma, or replica topology.
- Correction: an initial instinct to invent admin CRUD screens was rejected.
  Admin UI is limited to identity/scope plus reports/bookings that already
  exist. Demo seed accounts with scrypt password hashes were added so login
  is real rather than client-side token minting.
- Docker: frontend container proxies `/api` and `/health` through the existing
  Nginx load balancer so the browser never addresses api1/api2/api3 directly.

## Tier 1 correctness follow-up

- Delegated: close remaining Tier 1 gaps against ARCHITECTURE.md.
- Corrections: hold expiry used a raw `UPDATE ... SET status = EXPIRED`; it now
  goes through `transitionBookingInTransaction`. Checkout was an 8-minute hold
  with an unused 10-minute timestamp; `POST /checkout` now extends the hold.
  Policy had no write API; versioned PUT was added. A report UUID negative test
  and an end-to-end hold-pay-confirm test were added.
- At that point in the build, k6 numbers and full-profile benchmark captures
  were not yet claimed; the later local benchmark is documented in
  `LOAD_TEST.md`.

## Final verification

- Backend tests passed: 13 suites and 128 tests.
- Backend and frontend production builds passed.
- The mandatory proof passed through the local Nginx load balancer on
  2026-08-25: one room success and 199 conflicts; three equipment successes
  and 197 conflicts; zero unexpected responses.
- Vercel backend and frontend deployments were verified at the URLs in
  `README.md`. Production health, login, CORS, venue authorization, and
  unauthenticated Paygate refund protection were checked.
- Issue 4 follow-up: webhook processing now serializes on the payment row,
  persists stale events, and uses provider timestamps without allowing a
  captured payment to regress. Focused payment coverage is 14 passing tests.
- Issue 5 follow-up: verified the explicit provider progression rules for
  processing, failure, recovery to success, duplicate delivery, terminal
  success, and late success after expiry. Added duplicate-failure coverage.
- Paygate chaos remains only partially verified: transient failures, duplicate
  deliveries, delayed deliveries, and invalid signatures are covered, while
  the exact 25% response race and cross-charge out-of-order delivery are not
  fully simulated. Full-profile latency numbers and `EXPLAIN ANALYZE` captures
  were verified later and are documented in `LOAD_TEST.md`.


## Render backend packaging

- Delegated: make the API bootable on Render Hobby without a paid database.
- Choices: Node web service with `rootDir=backend`, migrate-on-start, listen on
  `0.0.0.0`, and in-process hold expiry instead of a second Render worker.
- Correction: Paygate loopback defaults used `localhost`, which can resolve to
  IPv6 (`::1`) while the server binds IPv4. Defaults are now `127.0.0.1:$PORT`.
- Prisma CLI moved to production dependencies so `migrate deploy` survives
  `npm prune --omit=dev`. Demo seed is documented as a local one-off against
  Neon, not part of the Render start command.
## Revenue and utilisation report

- Delegated to Copilot: inspect and verify the existing venue report before moving to the next Tier 2 item.
- Correction recorded: the original query had no utilisation percentage and aggregated directly across payment joins. It now aggregates each booking first, then calculates bounded-window room utilisation.
- Chosen definition: booked room minutes divided by total room capacity in the requested time window. This was recorded in `KNOWN_ISSUES.md`; `ARCHITECTURE.md` was not changed.
- Added direct-ID cross-venue revenue-report authorization coverage and exposed utilisation in the existing reports UI.

## Tier 2 verification and seed profiles

- Delegated to Copilot: verify report/reconciliation integration behavior and exact seed profile counts against a clean database.
- Correction recorded: the seed profile constants were correct, but the five required demo accounts were originally added on top of the configured user count and booking dates spanned multiple years. The seed now reserves five users for those accounts and cycles bookings across exactly 24 calendar months.
- Correction recorded: `prisma:seed` originally failed to forward `--profile`; the npm script now passes arguments through to the seed program.
- Verification limitation: integration fixtures and demo seeding could not run because the configured Neon host was unreachable. No database counts or integration assertions are claimed as passed.

## Vercel deployment preparation

- Delegated to Copilot: prepare the Express backend for zero-cost Vercel Hobby
  deployment as a serverless function, preserving all assessment invariants.
- Discovery: `vercel.json` with `functions: { "api/index.ts": { runtime: "nodejs22.x" } }`
  was rejected at build time as `unsupported "runtime" value in config: "nodejs24.x"`.
  The `functions`-block runtime must be `"nodejs"` in the function's own
  `export const config`, not a version-pinned string.
- Correction: moved `runtime` and `maxDuration` into `export const config` in
  `backend/api/index.ts` (`runtime: 'nodejs'`, `maxDuration: 30`); removed the
  `functions` and `buildCommand` keys from `backend/vercel.json` (Vercel
  auto-detects the build script from `package.json`). Added `postinstall:
  "prisma generate"` so the Prisma client is generated after `npm install` on
  Vercel's build machine. Added `backend/public/index.html` as a minimal landing
  page for the API root.
- Verification: `npx vercel build --project atrium-api --yes` compiles the
  serverless function successfully — `.vercel/output/functions/api/index.func/.vc-config.json`
  confirms `"runtime": "nodejs22.x"` and `"maxDuration": 30`. The only failure
  is `npm install` hitting `EPERM` on Windows file locks (local-only; does not
  occur on Vercel Linux). `tsc -p tsconfig.build.json` passes with exit code 0.
- Docker Compose (`docker compose up`) and the Nginx load balancer are untouched.
