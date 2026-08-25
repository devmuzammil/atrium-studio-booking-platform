# Timeline

## Implemented
- Architecture and schema, then auth, search, holds, Paygate, cancellation, reports.
- Frontend reviewer flow: search, hold, checkout, pay, bookings, reports, policy editor.
- Hold expiry routed through the booking state machine.
- Checkout endpoint grants a 10-minute window and may extend the 8-minute hold.
- Versioned cancellation policy API for venue admins.
- Vercel serverless adapter (backend/api/index.ts) with lazy housekeeping and
  daily cron; Render packaging (in-process paygate, migrate-on-start).

## Cut
- Tier 3 features — live heatmap, natural-language search, recurring bookings,
  waitlists, and notifications were intentionally not started.

## Verified Late In The Window
- Live hosting (Vercel) — backend and frontend deployed and verified on
  2026-08-25 at the URLs in `README.md`.
- Three-replica concurrency proof — rerun through Nginx on 2026-08-25 with
  1/199 room and 3/197 equipment success/conflict results.
- Full-profile load test and `EXPLAIN ANALYZE` evidence — captured locally and
  documented in `LOAD_TEST.md`.
- Room/equipment/pricing admin CRUD (Tier 2) — completed after the initial cut
  list was written.
