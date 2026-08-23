# Known issues and remaining gaps

## Implemented
- PostgreSQL exclusion constraints for rooms; row locks + interval sweep for equipment.
- Booking transitions go through `bookingStateMachine` (including hold expiry).
- 8-minute hold TTL; `POST /api/bookings/:id/checkout` grants at least 10 minutes without shortening an existing window.
- Paygate mock, idempotent charges, signed webhooks, INV-4 late-success refund.
- Cancellation uses stored policy snapshots; venue admins replace active tiers via API.
- Venue-scoped room and equipment management APIs are implemented for venue and platform admins.
- Revenue reports return successful-payment revenue, confirmed/completed booking minutes, and bounded-window utilisation.
- Utilisation is booked room minutes divided by room count multiplied by requested window minutes; it is null without a bounded window.
- Seed `--profile=demo` and `--profile=full`.
- Compose file: Postgres + three API replicas + Nginx + web.

## Not verified / not finished
- No public deployment URLs.
- Three-replica 200-request proof must be re-run through Nginx; output is not recorded in this workspace.
- Paygate `CHAOS=on` burst previously returned Nginx 502s. Not a pass.
- No load-test percentiles or EXPLAIN ANALYZE evidence.
- Full database verification of report metrics and management integration tests remains blocked when the configured Neon database is unavailable.
- Seed profile execution and exact count verification are currently blocked by the unavailable configured Neon database; the seed command now correctly forwards `--profile` arguments.
