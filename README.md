# Atrium Studio Booking Platform

Booking platform for creative studios: time-interval rooms and quantity-interval
equipment, with holds, a mock Paygate, and venue-scoped roles.

## Tech Stack

- **Frontend:** React, TypeScript, Tailwind CSS, Vite
- **Backend:** Node.js, Express, TypeScript
- **Database:** PostgreSQL + Prisma
- **Authentication:** JWT
- **Infrastructure:** Docker Compose + Nginx
- **Local topology:** Three API replicas behind Nginx

## Five-minute local run

From the repository root:

```powershell
docker compose up --build
```

This starts PostgreSQL, three API replicas, the Nginx load balancer, and the
frontend. The services are available at:

- Load balancer / API: http://localhost:8080
- Frontend: http://localhost:5173
- Health: http://localhost:8080/health

The frontend proxies `/api` and `/health` through Nginx. The health response
includes an `x-instance-id` identifying the API replica.

## Local development without Docker

```powershell
cd backend
npm install
npx prisma generate
npx prisma migrate deploy
npm run prisma:seed -- --profile=demo
npm run dev
```

In a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Vite proxies `/api`, `/health`, and `/paygate` to `http://localhost:3000`.

## Demo logins

Seeded by `--profile=demo` or `--profile=full`. Password for all accounts:
`Password123!`

| Email | Role |
| --- | --- |
| customer@atrium.local | CUSTOMER |
| staff@atrium.local | VENUE_STAFF |
| admin-a@atrium.local | VENUE_ADMIN (venue 1) |
| admin-b@atrium.local | VENUE_ADMIN (venue 2) |
| platform@atrium.local | PLATFORM_ADMIN |

## Seed profiles

The same seed script supports both volumes:

```powershell
cd backend
npm run prisma:seed -- --profile=demo
npm run prisma:seed -- --profile=full
```

`demo` is sized for a free hosted database. `full` is local-only for
benchmarking.

## Frontend routes

| Path | Purpose |
| --- | --- |
| `/login` | Sign in |
| `/search` | Cross-venue availability search |
| `/book/:roomId` | Hold and optional equipment |
| `/checkout/:bookingId` | Checkout and Paygate payment |
| `/bookings` | Booking list |
| `/bookings/:id` | Booking detail and cancellation |
| `/reports` | Reconciliation and revenue |
| `/admin` | Identity and cancellation policy editor |
| `/health` | API dependency health |

## Core API

| Method | Path |
| --- | --- |
| POST | `/api/auth/login` |
| GET | `/api/auth/me` |
| GET | `/api/venues/search` |
| GET | `/api/rooms/:id/availability` |
| POST | `/api/bookings/holds` |
| POST | `/api/bookings/:id/checkout` |
| POST | `/api/bookings/:id/payment` (`Idempotency-Key` required) |
| POST | `/api/paygate/webhook` |
| POST | `/api/bookings/:id/cancel` |
| GET | `/api/bookings` |
| GET | `/api/bookings/:id` |
| GET | `/api/venues/:venueId/equipment` |
| GET | `/api/venues/:venueId/rooms` |
| POST | `/api/venues/:venueId/rooms` |
| PATCH/DELETE | `/api/rooms/:id` |
| POST | `/api/venues/:venueId/equipment` |
| PATCH/DELETE | `/api/equipment/:id` |
| GET | `/api/venues/:venueId/cancellation-policy` |
| PUT | `/api/venues/:venueId/cancellation-policy` |
| GET | `/api/reports/reconciliation` |
| GET | `/api/reports/revenue` |
| GET | `/health` |

Room double-booking is enforced by a PostgreSQL exclusion constraint. Equipment
capacity is enforced with `SELECT ... FOR UPDATE` and an interval sweep. Both
mechanisms live in the database, not in process memory.

Venue-scoped resource reads resolve the target room or venue first and use the
shared authorization policy; cross-venue UUID access is denied. Internal mock
Paygate charge/refund routes require the signed provider request, while booking
payments and webhooks use their separate authenticated/signature boundaries.
Refunds lock the charge row, enforce captured amount and currency limits, and
use durable idempotency keys. Failed refunds remain `PROCESSING` and are
retryable rather than being reported as complete.

Webhook events are persisted before their business effect. Payment rows are
locked while applying events; a captured success is terminal over later
failures, and timestamped events older than the latest event are ignored while
remaining queryable for reconciliation. A success after hold expiry creates a
pending refund and cannot confirm the booking.

## Tests and builds

```powershell
cd backend
npm test
npm run build
```

```powershell
cd frontend
npm run build
```

The mandatory three-replica concurrency proof targets Nginx, not one API:

```powershell
cd backend
$env:CONCURRENCY_API_URL="http://localhost:8080"
$env:CONCURRENCY_USER_TOKEN="<jwt>"
$env:CONCURRENCY_ROOM_ID="<room uuid>"
$env:CONCURRENCY_START="<iso>"
$env:CONCURRENCY_END="<iso>"
$env:CONCURRENCY_EQUIPMENT_ID="<equipment uuid>"
$env:CONCURRENCY_EQUIPMENT_ROOM_IDS="<room-a>,<room-b>,<room-c>"
npm run test:concurrency
```

With the Compose stack and demo seed running, the proof discovers the demo
credentials, room, venue, and exactly-three-unit equipment fixture itself.

Expected results are one room `201`, 199 room `409`s, at most three equipment
successes, and no unexpected `500`s.

## Deployment

- API: https://atrium-api.vercel.app
- Frontend: https://atrium-one.vercel.app
- Deployment uses the Vercel projects configured in `backend/vercel.json` and
  `frontend/vercel.json`.

## Known Issues and What I Did Not Finish

- A previous Paygate chaos burst produced Nginx `502` responses and requires a
  clean rerun before it can be called verified.
- `LOAD_TEST.md` does not contain reproducible p50/p95/p99 or `EXPLAIN ANALYZE`
  captures. Those numbers must not be fabricated.
- Webhook verification, event persistence, and booking application remain in
  the webhook request; events are durable but there is no separate queue worker
  for that path.
- Tier 3 features such as heatmap, natural-language search, recurring
  bookings, waitlists, and notifications were intentionally not started.

The local Compose stack and the deployed Vercel API/frontend were verified on
2026-08-25. Production CORS currently permits browser requests from the
configured deployment and the API health, login, venue authorization, and
Paygate route protection checks passed.

If a hold expires while payment is in flight, the booking cannot become
`CONFIRMED`; a captured charge creates a recoverable pending refund and reaches
`REFUNDED` only after the provider refund succeeds.
