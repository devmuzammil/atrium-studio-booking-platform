# Performance Benchmark

## Environment

- OS: Microsoft Windows NT 10.0.26200.0
- CPU: 13th Gen Intel(R) Core(TM) i5-13420H
- RAM: 15.65 GB
- PostgreSQL: 16.15 (Docker `postgres:16-alpine`)
- Node: v20.19.0
- Benchmark tool: native Node.js `fetch` and `perf_hooks` (no extra dependency)
- Docker: 28.1.1, build 4eba377

## Dataset

The benchmark was run against a clean `--profile=full` database:

| Entity | Actual count |
|---|---:|
| Venues | 40 |
| Rooms | 800 |
| Equipment types | 280 |
| Equipment units | 2,500 |
| Bookings | 250,000 |
| Users | 5,000 |

Cities were Karachi (14 venues), Dubai (13), and London (13). Booking slots
ran from 2024-01-01 through 2025-12-27, covering 24 calendar months.

## Startup

From the repository root, using a disposable local PostgreSQL volume:

```powershell
docker compose down -v
docker compose up -d postgres
cd backend
npx prisma migrate deploy
npm run prisma:seed -- --profile=full
cd ..
docker compose up --build -d
```

The benchmark target is the Nginx load balancer at `http://localhost:8080`.
The full dataset remains local-only.

## Benchmark command

The script is [backend/performance/benchmark.mjs](backend/performance/benchmark.mjs).
It requires a seeded account and does not contain a password or token:

```powershell
cd backend
$env:BASE_URL="http://localhost:8080"
$env:BENCHMARK_EMAIL="admin-a@atrium.local"
$env:BENCHMARK_PASSWORD="<seeded password>"
$env:BENCHMARK_VUS="4"
$env:BENCHMARK_ITERATIONS="40"
node performance/benchmark.mjs
```

The run warms each operation once, then sends 40 requests per operation with
four concurrent workers. Holds use authorized rooms from the seeded admin's
venue and vary the slot by day. The script reports HTTP status counts and
latency percentiles from actual responses.

## Workload

- `GET /api/rooms/:id/availability`: seven-day window.
- `GET /api/venues/search`: Karachi, minimum capacity 4, `daylight` amenity,
  price ceiling 20,000, and seven-day availability in one request.
- `POST /api/bookings/holds`: one-hour authenticated holds across the selected
  venue's rooms.
- `GET /api/reports/revenue`: authorized venue report over 30 days.
- Authentication: seeded `VENUE_ADMIN` login and JWT `Authorization` header.
- Request path: every request went through Nginx at `localhost:8080`.

## Results

Measured 2026-08-25 against the full profile, 40 requests per endpoint, four
concurrent workers, after one warm-up request per endpoint:

| Endpoint | p50 | p95 | p99 | Error rate | Target | Result |
|---|---:|---:|---:|---:|---:|---|
| Room availability | 14.82 ms | 18.44 ms | 19.10 ms | 0% | <300 ms | PASS |
| Cross-venue search | 16.30 ms | 22.83 ms | 23.55 ms | 0% | <500 ms | PASS |
| Create hold | 34.51 ms | 51.68 ms | 55.04 ms | 0% | <250 ms | PASS |
| Revenue report | 42.54 ms | 58.00 ms | 67.87 ms | 0% | <800 ms | PASS |

Raw benchmark output used for this table:

```json
{
  "baseUrl": "http://localhost:8080",
  "requestsPerEndpoint": 40,
  "concurrency": 4,
  "warmup": true,
  "start": "2026-08-26T10:00:00.000Z",
  "end": "2026-08-26T11:00:00.000Z",
  "results": [
    { "endpoint": "GET /api/rooms/:id/availability (7 days)", "p50": 14.8208, "p95": 18.4389, "p99": 19.1048, "errorRate": 0, "statuses": { "200": 40 } },
    { "endpoint": "GET /api/venues/search (combined filters)", "p50": 16.2967, "p95": 22.8324, "p99": 23.5454, "errorRate": 0, "statuses": { "200": 40 } },
    { "endpoint": "POST /api/bookings/holds", "p50": 34.5104, "p95": 51.6753, "p99": 55.0442, "errorRate": 0, "statuses": { "201": 40 } },
    { "endpoint": "GET /api/reports/revenue (30 days)", "p50": 42.5424, "p95": 58.0005, "p99": 67.8722, "errorRate": 0, "statuses": { "200": 40 } }
  ]
}
```

## EXPLAIN ANALYZE - Before

The availability query already had its production GiST index in the migration.
To obtain a truthful no-index baseline on the same dataset, the capture used
`SET LOCAL enable_indexscan=off` and `SET LOCAL enable_bitmapscan=off` inside a
rolled-back transaction. Complete output: [before evidence](docs/performance/explain-availability-before.txt).

The planner used a `Parallel Seq Scan` over bookings, removed 83,349 rows per
worker, touched 5,407 shared buffers, and took 24.430 ms execution time.

## EXPLAIN ANALYZE - After

The same SQL, room, seven-day window, and database used normal planner settings.
Complete output: [after evidence](docs/performance/explain-availability-after.txt).

The planner used `Index Scan using bookings_active_room_slot_gist_idx`, touched
32 shared buffers, and took 0.440 ms execution time. Planning time was 1.613 ms.

## Query and indexing strategy

The analyzed SQL is the exact query in `getRoomAvailability`:

```sql
SELECT lower(b.slot) AS start, upper(b.slot) AS end, b.status::text AS status
FROM bookings b
WHERE b.room_id = $1::uuid
  AND b.status IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED')
  AND b.protected_slot && tstzrange($2, $3, '[)')
ORDER BY lower(b.slot);
```

Relevant existing index:

```sql
CREATE INDEX bookings_active_room_slot_gist_idx
  ON bookings USING GIST (room_id, protected_slot)
  WHERE status IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED');
```

No index was added for this benchmark. The before/after comparison demonstrates
that the existing partial GiST index is effective for the production query:
24.430 ms sequential-scan baseline versus 0.440 ms indexed execution on this
run. These are measured execution times, not guarantees for other hardware.

## Reproduction

1. Reset and seed the full profile using the startup commands above.
2. Start the Compose API replicas and Nginx.
3. Run `node performance/benchmark.mjs` with the documented environment.
4. Run the two `psql` commands represented in the evidence files, changing only
the fixture UUID/window if the fresh seed produces different IDs.

The benchmark is local-only and does not represent the deployed Vercel dataset.
