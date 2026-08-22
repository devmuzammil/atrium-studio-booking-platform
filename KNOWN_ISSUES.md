# Known issues and remaining gaps

## Implemented and Verified in This Environment
- PostgreSQL-backed booking state machine and append-only auditing logic are in place and tested.
- Hold expiry concurrency fix validated: all 7 hold-expiry regression tests pass, including concurrent expiry attempts.
- Docker Compose topology configuration created and validated (docker compose config succeeds).
- Health route exposes an environment-driven instance ID via x-instance-id header.
- Backend TypeScript build passes successfully.
- All Tier 1 business logic tests pass (hold-expiry, booking state machine, concurrency safety).
- Mandatory Nginx concurrency proof passes: room 1 success/199 conflicts and equipment 3 successes/197 conflicts, with zero unexpected responses.
- Tenant-isolation negative test passes 10/10.
- Payment integrity tests pass 8/8; clean reconciliation returns zero discrepancies.
- Compose runtime is healthy with three API replicas and Nginx distribution verified at 10/10/10 across 30 health requests.

## Not Verified or Failed
- Paygate chaos burst is not passing: with `PAYGATE_CHAOS=on`, 100 concurrent charge attempts produced 47 HTTP 202, 1 HTTP 500 after retry, and 52 HTTP 502 responses while Nginx reported no live upstreams.
- The lower-rate chaos run produced 30/30 eventual HTTP 202 responses, 3 same-key retries, 30 persisted charges, 35 success events including duplicate deliveries, and a live invalid-signature 401. Delayed, race-before-202, and out-of-order behavior still need dedicated assertions.
- Full benchmark metrics (p50/p95/p99/throughput/error rates) are not captured.
- EXPLAIN ANALYZE before/after evidence is not captured.
- Public deployment and deployed demo-profile verification are not complete.

## Risk
The assessment cannot be declared Tier 1 complete until Paygate chaos passes without upstream failures, performance evidence is captured, and the required deployment is live.

All required manual verification commands are documented in [DOCKER_VERIFICATION_COMMANDS.md](DOCKER_VERIFICATION_COMMANDS.md) for execution on a machine with Docker Engine or Docker Desktop running.

## Not Implemented / Outside Scope
- Frontend/React admin console (Tier 2 work).
- Public/live deployment and live credentials (requires hosting infrastructure).
- Real payment provider integration (currently uses mock Paygate).
