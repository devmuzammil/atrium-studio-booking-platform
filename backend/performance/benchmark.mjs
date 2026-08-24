import { performance } from 'node:perf_hooks';

const baseUrl = (process.env.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
const email = process.env.BENCHMARK_EMAIL;
const password = process.env.BENCHMARK_PASSWORD;
const vus = Number(process.env.BENCHMARK_VUS || 4);
const iterations = Number(process.env.BENCHMARK_ITERATIONS || 40);

if (!email || !password) {
  throw new Error('BENCHMARK_EMAIL and BENCHMARK_PASSWORD are required');
}

const start = new Date(process.env.START_TIME || Date.now() + 2 * 24 * 60 * 60 * 1000);
start.setUTCHours(10, 0, 0, 0);
const end = new Date(start.getTime() + 60 * 60 * 1000);
const sevenDayEnd = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
const reportEnd = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);

async function request(path, options = {}) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${path}`, options);
  await response.arrayBuffer();
  return { status: response.status, elapsed: performance.now() - started };
}

async function login() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`Login failed: HTTP ${response.status}`);
  return response.json();
}

function percentile(values, percentileValue) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[index];
}

async function runWorkload(name, operation) {
  const results = [];
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= iterations) return;
      results.push(await operation(index));
    }
  }
  await Promise.all(Array.from({ length: Math.min(vus, iterations) }, worker));
  const latencies = results.map((result) => result.elapsed);
  const errors = results.filter((result) => result.status < 200 || result.status >= 300);
  return {
    endpoint: name,
    requests: results.length,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    errorRate: (errors.length / results.length) * 100,
    statuses: Object.fromEntries([...new Set(results.map((result) => result.status))].map((status) => [status, results.filter((result) => result.status === status).length])),
  };
}

const identity = await login();
const token = process.env.BENCHMARK_TOKEN || identity.token;
const venueId = process.env.VENUE_ID || identity.user.roles[0]?.venueId;
if (!venueId) throw new Error('No venue scope found for benchmark user');

const searchParams = new URLSearchParams({ start: start.toISOString(), end: sevenDayEnd.toISOString(), city: 'Karachi', minCapacity: '4', amenities: 'daylight', maxPrice: '20000' });
const searchResponse = await fetch(`${baseUrl}/api/venues/search?${searchParams}`, { headers: { authorization: `Bearer ${token}` } });
if (!searchResponse.ok) throw new Error(`Room discovery failed: HTTP ${searchResponse.status}`);
const search = await searchResponse.json();
const venueRoomsResponse = await fetch(`${baseUrl}/api/venues/${encodeURIComponent(venueId)}/rooms`, { headers: { authorization: `Bearer ${token}` } });
if (!venueRoomsResponse.ok) throw new Error(`Venue room discovery failed: HTTP ${venueRoomsResponse.status}`);
const venueRooms = await venueRoomsResponse.json();
const rooms = venueRooms.rooms || [];
if (rooms.length === 0) throw new Error(`No rooms found for venue ${venueId}`);
const roomId = process.env.ROOM_ID || rooms[0].id;
const headers = { authorization: `Bearer ${token}` };

await request(`/api/rooms/${roomId}/availability?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(sevenDayEnd.toISOString())}`, { headers });
await request(`/api/venues/search?${searchParams}`, { headers });
await request(`/api/reports/revenue?venueId=${encodeURIComponent(venueId)}&start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(reportEnd.toISOString())}`, { headers });

const results = [];
results.push(await runWorkload('GET /api/rooms/:id/availability (7 days)', () => request(`/api/rooms/${roomId}/availability?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(sevenDayEnd.toISOString())}`, { headers })));
results.push(await runWorkload('GET /api/venues/search (combined filters)', () => request(`/api/venues/search?${searchParams}`, { headers })));
results.push(await runWorkload('POST /api/bookings/holds', (index) => request('/api/bookings/holds', {
  method: 'POST',
  headers: { ...headers, 'content-type': 'application/json' },
  body: JSON.stringify({ roomId: rooms[index % rooms.length].id, start: new Date(start.getTime() + index * 24 * 60 * 60 * 1000).toISOString(), end: new Date(end.getTime() + index * 24 * 60 * 60 * 1000).toISOString(), equipment: [] }),
})));
results.push(await runWorkload('GET /api/reports/revenue (30 days)', () => request(`/api/reports/revenue?venueId=${encodeURIComponent(venueId)}&start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(reportEnd.toISOString())}`, { headers })));

console.log(JSON.stringify({ baseUrl, requestsPerEndpoint: iterations, concurrency: vus, warmup: true, start: start.toISOString(), end: end.toISOString(), venueId, roomId, results }, null, 2));