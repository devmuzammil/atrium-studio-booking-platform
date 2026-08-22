# Docker Stack Verification Commands

The local development environment does not have a Docker daemon running. Use these commands on a machine with Docker Desktop or Docker Engine running to complete the remaining Tier 1 verification phases.

## Prerequisites
- Docker Desktop or Docker Engine running
- Docker Compose v2.0+
- Node.js v20+
- PostgreSQL CLI tools (optional, for manual queries)
- curl or similar HTTP client

## Phase 2: Run the Real Docker Environment

### Step 1: Validate Compose Configuration
```bash
cd /path/to/atrium-studio-booking-platform
docker compose config
```

Expected output: Valid compose configuration with postgres, api1, api2, api3, nginx services

### Step 2: Build All Images
```bash
docker compose build --no-cache
```

Expected: All images built successfully
- PostgreSQL image ready
- Backend TypeScript compiled and bundled
- Nginx configuration loaded

### Step 3: Start the Stack
```bash
docker compose up -d
```

Expected: All services start in background

### Step 4: Wait for Health Checks (60 seconds)
```bash
sleep 60
docker compose ps
```

Expected output:
```
NAME                 IMAGE                      STATUS
atrium-postgres      postgres:17                Up (healthy)
atrium-api-1         backend:latest             Up (healthy)
atrium-api-2         backend:latest             Up (healthy)
atrium-api-3         backend:latest             Up (healthy)
atrium-nginx         nginx:latest               Up (healthy)
```

All containers must show `Up (healthy)` status.

### Step 5: Verify Database Initialization
```bash
docker compose exec postgres psql -U atrium -d atrium -c "SELECT COUNT(*) as venue_count FROM venues;"
```

Expected: At least one venue exists (database was seeded)

### Step 6: Check API Logs
```bash
docker compose logs api1 | tail -20
docker compose logs api2 | tail -20
docker compose logs api3 | tail -20
```

Expected: No errors, shows "listening on port 3000"

### Step 7: Verify Nginx Connectivity
```bash
docker compose exec nginx curl -v http://localhost:80/health
```

Expected: HTTP 200 with JSON response `{"status":"ok","dependencies":{"postgres":"ok","paygate":"ok"}}`

---

## Phase 3: Verify Nginx and Replica Distribution

### Step 1: Confirm Nginx Upstream Configuration
```bash
docker compose exec nginx cat /etc/nginx/nginx.conf | grep -A 20 "upstream"
```

Expected: Shows three upstreams named api1, api2, api3

### Step 2: Test Health Distribution (Run 30 times)
```bash
for i in {1..30}; do
  echo "Request $i:"
  curl -s http://localhost/health | jq '.x-instance-id // "error"'
done | sort | uniq -c
```

Expected output shows requests distributed across:
- api-1 (approximately 10 requests)
- api-2 (approximately 10 requests)
- api-3 (approximately 10 requests)

Example expected distribution:
```
     10 "api-1"
     10 "api-2"
     10 "api-3"
```

### Step 3: Direct API Health Checks
```bash
curl -s http://localhost:3000/health -H "Host: api1" | jq .
curl -s http://localhost:3000/health -H "Host: api2" | jq .
curl -s http://localhost:3000/health -H "Host: api3" | jq .
```

Each should return:
```json
{
  "status": "ok",
  "dependencies": {
    "postgres": "ok",
    "paygate": "ok"
  }
}
```

---

## Phase 4: Execute the Real Concurrency Proof

### Step 1: Run Concurrency Proof Through Nginx
```bash
cd backend
npm test -- --runTestsByPath tests/concurrencyProof.test.ts --testNamePattern="via load balancer" 2>&1 | tee concurrency-proof-output.txt
```

This test:
- Sends 200 concurrent requests to http://localhost/api/bookings/hold (through Nginx)
- Tests room availability with configured capacity
- Tests equipment inventory with configured limits
- Verifies no overbooking occurs
- Verifies no conflicting room allocations

Expected output:
```
PASS  tests/concurrencyProof.test.ts
  concurrency proof via load balancer
    ✓ allows 200 concurrent holds without overselling rooms (duration: XXXms)
    ✓ enforces equipment inventory limits under 200 concurrent requests (duration: XXXms)
```

### Step 2: Capture Full Output
```bash
cat concurrency-proof-output.txt
```

Save this output as evidence of passing the concurrency proof.

---

## Phase 5: Run the Load Test

### Step 1: Install Load Testing Tool (if not present)
```bash
npm install -g autocannon
# OR
npm install -D autocannon
```

### Step 2: Run Load Test (60 seconds, ramping to 50 concurrent)
```bash
cd backend
npx autocannon \
  --duration 60 \
  --connections 10 \
  --pipelining 1 \
  --amount 200 \
  http://localhost/health
```

Alternative using Apache Bench (if available):
```bash
ab -n 1000 -c 50 http://localhost/health
```

Alternative using wrk (if available):
```bash
wrk -t4 -c50 -d60s http://localhost/health
```

### Step 3: Capture Metrics
Record:
- Total requests
- Successful responses (2xx)
- Error responses (4xx, 5xx)
- p50 latency
- p95 latency
- p99 latency
- Throughput (req/sec)
- Test duration

Example output capture:
```bash
npx autocannon \
  --duration 60 \
  --connections 50 \
  --pipelining 1 \
  http://localhost/health 2>&1 | tee load-test-output.txt

# Extract key metrics
echo "=== Load Test Results ===" >> LOAD_TEST_EVIDENCE.md
echo "Test Command: autocannon --duration 60 --connections 50 http://localhost/health" >> LOAD_TEST_EVIDENCE.md
cat load-test-output.txt >> LOAD_TEST_EVIDENCE.md
```

### Step 4: Record Environment
```bash
cat > LOAD_TEST_ENVIRONMENT.txt << 'EOF'
Date: $(date)
OS: $(uname -a)
Docker Version: $(docker --version)
Docker Compose Version: $(docker compose version)
PostgreSQL Version: $(docker compose exec postgres psql -U atrium -d atrium -c "SELECT version();" 2>/dev/null | grep -i postgresql)
Node Version: $(docker compose exec api1 node --version)
API Replicas: 3 (api1, api2, api3)
Database: PostgreSQL 17 (single instance, shared by all replicas)
Load Balancer: Nginx (round-robin)
EOF
```

---

## Phase 6: EXPLAIN ANALYZE

### Step 1: Identify Critical Booking Query
The primary query path is room availability search:
```sql
SELECT DISTINCT b.id
FROM bookings b
WHERE b.room_id = $1::uuid
  AND b.status IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED')
  AND b.protected_slot && $2::tstzrange
LIMIT 1;
```

### Step 2: Capture EXPLAIN ANALYZE Before (Current State)
```bash
docker compose exec postgres psql -U atrium -d atrium << 'EOF'
EXPLAIN ANALYZE
SELECT DISTINCT b.id
FROM bookings b
WHERE b.room_id = '11111111-1111-1111-1111-111111111111'::uuid
  AND b.status IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED')
  AND b.protected_slot && '[2026-08-23 10:00:00+05, 2026-08-23 11:00:00+05)'::tstzrange
LIMIT 1;
EOF
```

Save output to: `EXPLAIN_ANALYZE_BEFORE.txt`

### Step 3: Run Load Test to Populate Data
Load some sample bookings:
```bash
cd backend
npm run prisma:seed
# Then run concurrency proof to create many bookings
npm test -- --runTestsByPath tests/concurrencyProof.test.ts
```

### Step 4: Capture EXPLAIN ANALYZE After Load
```bash
docker compose exec postgres psql -U atrium -d atrium << 'EOF'
EXPLAIN ANALYZE
SELECT DISTINCT b.id
FROM bookings b
WHERE b.room_id = (SELECT id FROM rooms LIMIT 1)::uuid
  AND b.status IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED')
  AND b.protected_slot && '[2026-08-23 10:00:00+05, 2026-08-23 11:00:00+05)'::tstzrange
LIMIT 1;
EOF
```

Save output to: `EXPLAIN_ANALYZE_AFTER.txt`

### Step 5: Compare Query Plans
Document:
- Execution time before
- Execution time after
- Index usage (Seq Scan vs Index Scan)
- Number of rows scanned
- Join method changes (if any)
- Planner estimates vs actual rows

---

## Phase 7: Finalize Architecture Documentation

### Step 1: Update ARCHITECTURE.md with Verified Evidence
Add a new section at the end:
```markdown
## 8. Verified Runtime Topology

### Docker Stack Verification
- ✓ PostgreSQL started with migrations applied
- ✓ API Replica 1 healthy at http://localhost:3001 (internal)
  - Instance ID: api-1
  - Health check: PASSED
- ✓ API Replica 2 healthy at http://localhost:3002 (internal)
  - Instance ID: api-2
  - Health check: PASSED
- ✓ API Replica 3 healthy at http://localhost:3003 (internal)
  - Instance ID: api-3
  - Health check: PASSED
- ✓ Nginx Load Balancer healthy at http://localhost:80
  - Upstream algorithm: round-robin
  - Health distribution verified across 30 requests

### Concurrency Proof Results
- ✓ 200 concurrent hold requests through Nginx
- ✓ Room capacity invariant: PASSED
  - Requested: 50 rooms
  - Successful allocations: <= 50
- ✓ Equipment inventory invariant: PASSED
  - Total equipment units: [X]
  - Successful allocations: <= [X]
- ✓ No conflicting room bookings: PASSED
- ✓ Single audit event per transition: PASSED

### Load Test Results
- Throughput: [X] req/sec
- p50: [X]ms
- p95: [X]ms
- p99: [X]ms
- Success rate: [X]%
- Error rate: [X]%
- Test duration: 60 seconds
- Concurrent connections: 50

### Query Optimization
- Booking search query optimization verified
- Index usage: [BEFORE: Seq Scan] → [AFTER: Index Scan on protected_slot GiST]
- Performance improvement: [X]% faster

### Known Limitations
- Frontend/React UI not implemented (Tier 2 work)
- Public cloud deployment not configured (requires specific hosting)
- Real payment provider integration uses mock Paygate (requires credentials)
```

### Step 2: Create Test Evidence Directory
```bash
mkdir -p ./TIER_1_EVIDENCE
cp concurrency-proof-output.txt ./TIER_1_EVIDENCE/
cp load-test-output.txt ./TIER_1_EVIDENCE/
cp LOAD_TEST_ENVIRONMENT.txt ./TIER_1_EVIDENCE/
cp EXPLAIN_ANALYZE_BEFORE.txt ./TIER_1_EVIDENCE/
cp EXPLAIN_ANALYZE_AFTER.txt ./TIER_1_EVIDENCE/
```

### Step 3: Commit Evidence
```bash
git add ARCHITECTURE.md TIER_1_EVIDENCE/
git commit -m "Tier 1 verification complete: Docker topology, concurrency proof, load test, query optimization"
```

---

## Cleanup Commands

### Stop All Services
```bash
docker compose down
```

### Remove All Volumes (Reset Database)
```bash
docker compose down -v
```

### Remove All Images
```bash
docker rmi atrium-studio-booking-platform-api1 atrium-studio-booking-platform-api2 atrium-studio-booking-platform-api3
docker rmi postgres:17
docker rmi nginx:latest
```

---

## Troubleshooting

### Containers Not Healthy
```bash
docker compose logs postgres
docker compose logs api1
docker compose logs nginx
```

### Database Connection Refused
```bash
docker compose exec postgres psql -U atrium -d atrium -c "SELECT 1;"
```

### Nginx Can't Reach Upstreams
```bash
docker compose exec nginx curl -v http://api1:3000/health
docker compose exec nginx curl -v http://api2:3000/health
docker compose exec nginx curl -v http://api3:3000/health
```

### Load Balancer Not Distributing
```bash
for i in {1..10}; do curl -s http://localhost/health | jq .x-instance-id; done
```

### Clear Docker Cache and Rebuild
```bash
docker compose build --no-cache --pull
docker compose up -d --force-recreate
```
