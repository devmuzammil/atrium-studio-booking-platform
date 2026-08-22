# Decision log

## PostgreSQL as the source of truth
- Choice: keep PostgreSQL as the authoritative database for bookings, inventory, payments, and audit events.
- Rejected alternative: application-memory reservation state or a document store.
- Trade-off: this keeps correctness under multi-instance concurrency, but requires careful transaction design and more explicit SQL.

## Prisma with raw SQL for critical invariants
- Choice: use Prisma for typed application access and migrations while keeping PostgreSQL-specific range and locking logic in tagged raw SQL.
- Rejected alternative: full SQL-only application without Prisma.
- Trade-off: easier typed access and migration flow, while still writing the small set of SQL queries that enforce the critical invariants.

## Stateless API replicas behind a load balancer
- Choice: run multiple Node/Express instances against the same database and expose them behind Nginx.
- Rejected alternative: sticky sessions or in-process reservation state.
- Trade-off: better horizontal scale and correctness under concurrency, but it requires the database to remain the authority.

## Centralized booking state machine
- Choice: all booking transitions go through a single state transition service that validates current state and writes exactly one audit event.
- Rejected alternative: scattered direct updates in controllers.
- Trade-off: stronger correctness and simpler reasoning, at the cost of more explicit transition rules.

## Database-enforced room conflicts
- Choice: use PostgreSQL exclusion constraints and half-open ranges for room inventory.
- Rejected alternative: application-level check-then-insert.
- Trade-off: stronger correctness under concurrent requests, but it requires correct range semantics and accurate overlap logic.

## Transactional equipment checks
- Choice: lock inventory rows and re-check capacity before commit.
- Rejected alternative: a non-transactional counter.
- Trade-off: correct under contention, but requires careful ordering and more SQL work.

## Payment idempotency centered on database keys
- Choice: enforce idempotency using database unique keys and provider delivery IDs.
- Rejected alternative: deduplicating only in memory or only by request payload.
- Trade-off: business effects become durable and safe under retries, but the app must treat at-least-once webhooks as a normal input mode.

## Append-only audit trail
- Choice: audit rows are append-only and protected from mutation.
- Rejected alternative: editable audit records.
- Trade-off: stronger historical integrity, with a testing cost because teardown must not directly delete booking rows in a way that triggers the append-only trigger.
