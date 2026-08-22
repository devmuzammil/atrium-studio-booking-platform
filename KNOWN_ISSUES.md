# Known issues and remaining gaps

## Implemented and Verified in This Environment
- PostgreSQL-backed booking state machine and append-only auditing logic are in place and tested.
- Hold expiry concurrency fix validated: all 7 hold-expiry regression tests pass, including concurrent expiry attempts.
- Docker Compose topology configuration created and validated (docker compose config succeeds).
- Health route exposes an environment-driven instance ID via x-instance-id header.
- Backend TypeScript build passes successfully.
- All Tier 1 business logic tests pass (hold-expiry, booking state machine, concurrency safety).

## Not Verified (Docker Daemon Unavailable)
- Docker Compose startup: Docker daemon is not running in this environment.
  - Error: "Cannot find dockerDesktopLinuxEngine"
  - This is an environment limitation, not a code issue.
- Nginx load balancer health and upstream distribution.
- Three API replicas running concurrently and handling load-balanced requests.
- Real 200-request concurrency proof through the Nginx load balancer.
- Full benchmark metrics (p50/p95/p99/throughput/error rates).
- EXPLAIN ANALYZE query optimization evidence.
- Replica synchronization and database consistency under distributed load.

## Risk
The assessment cannot be declared Tier 1 complete until the Docker stack is actually executed in a Docker-capable environment.

All required manual verification commands are documented in [DOCKER_VERIFICATION_COMMANDS.md](DOCKER_VERIFICATION_COMMANDS.md) for execution on a machine with Docker Engine or Docker Desktop running.

## Not Implemented / Outside Scope
- Frontend/React admin console (Tier 2 work).
- Public/live deployment and live credentials (requires hosting infrastructure).
- Real payment provider integration (currently uses mock Paygate).
