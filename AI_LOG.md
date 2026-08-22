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