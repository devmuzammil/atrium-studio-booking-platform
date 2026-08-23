# Known issues and remaining gaps

## Implemented
- PostgreSQL exclusion constraints for rooms; row locks + interval sweep for equipment.
- Booking transitions go through `bookingStateMachine` (including hold expiry).
- 8-minute hold TTL; `POST /api/bookings/:id/checkout` grants at least 10 minutes without shortening an existing window.
- Paygate mock, idempotent charges, signed webhooks, INV-4 late-success refund.
- Cancellation uses stored policy snapshots; venue admins replace active tiers via API.
- Seed `--profile=demo` and `--profile=full`.
- Compose file: Postgres + three API replicas + Nginx + web.

## Not verified / not finished
- No public deployment URLs.
- Three-replica 200-request proof must be re-run through Nginx; output is not recorded in this workspace.
- Paygate `CHAOS=on` burst previously returned Nginx 502s. Not a pass.
- No load-test percentiles or EXPLAIN ANALYZE evidence.
- Room/equipment/pricing mutation APIs are absent.
