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
- Test issues discovered: remote Neon lock contention once exceeded the
  default interactive transaction timeout, so webhook processing now retries
  only transient Prisma transaction errors. Test cleanup also had to include
  unknown provider-event fixtures. These changes preserve database-level
  idempotency rather than hiding concurrency failures with mocks.