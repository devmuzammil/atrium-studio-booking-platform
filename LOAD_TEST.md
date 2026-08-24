# Load Test Plan

The full-profile latency benchmark has not been run in this workspace. No
latency numbers are claimed. The three-replica Compose deployment is
configured and the mandatory concurrency proof is documented below.

## Required Profiles

```powershell
cd backend
npm run prisma:seed -- --profile=full
```

Run the API through the intended load balancer and collect p50, p95, p99, and
error rate for:

- Seven-day room availability: p95 target under 300 ms
- Combined cross-venue search: p95 target under 500 ms
- Hold creation: p95 target under 250 ms
- Thirty-day venue report: p95 target under 800 ms

## Query Plan Evidence

After loading the full profile, run `EXPLAIN (ANALYZE, BUFFERS)` for the
availability query in `src/services/roomAvailabilityService.ts`, comparing the
plan before and after the existing GiST, venue, room, and JSONB indexes. Record
the complete output and machine specification here.

## Concurrency Preconditions

The 200-request proof must target the Nginx/load-balancer URL, not a single API
process. Configure the variables documented by
`tests/concurrencyProof.test.ts`, then run:

```powershell
npm run test:concurrency
```

The expected result is one room winner and 199 clean `409` responses, with
no unexpected `500` responses. The equipment case must never reserve more than
three units.
