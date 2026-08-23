# Timeline

## Implemented
- Architecture and schema, then auth, search, holds, Paygate, cancellation, reports.
- Frontend reviewer flow: search, hold, checkout, pay, bookings, reports, policy editor.
- Hold expiry routed through the booking state machine.
- Checkout endpoint grants a 10-minute window and may extend the 8-minute hold.
- Versioned cancellation policy API for venue admins.

## Cut
- Live hosting (Render/Vercel) — not done in this workspace.
- Pasting concurrency-proof stdout after a Nginx run on this machine.
- Full-profile load test numbers.
- Room/equipment/pricing admin CRUD (Tier 2).
- All Tier 3 features, by choice.
