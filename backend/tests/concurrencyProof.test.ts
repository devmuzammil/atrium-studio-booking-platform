import 'dotenv/config';

jest.setTimeout(60000);

const baseUrl = process.env.CONCURRENCY_API_URL || 'http://localhost:8080';

interface ProofFixture {
  token: string;
  roomId: string;
  start: string;
  end: string;
  equipmentId: string;
  equipmentRoomIds: string[];
}

async function discoverFixture(): Promise<ProofFixture> {
  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.CONCURRENCY_EMAIL || 'customer@atrium.local', password: process.env.CONCURRENCY_PASSWORD || 'Password123!' }),
  });
  if (!loginResponse.ok) throw new Error(`Concurrency fixture login failed: HTTP ${loginResponse.status}`);
  const login = await loginResponse.json() as { token: string };
  const token = process.env.CONCURRENCY_USER_TOKEN || login.token;
  const meResponse = await fetch(`${baseUrl}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } });
  if (!meResponse.ok) throw new Error(`Concurrency fixture identity lookup failed: HTTP ${meResponse.status}`);
  const me = await meResponse.json() as { user: { roles: Array<{ venueId: string }> } };
  const venueId = process.env.CONCURRENCY_VENUE_ID || me.user.roles[0]?.venueId;
  if (!venueId) throw new Error('Concurrency fixture found no assigned venue');
  const startDate = new Date(process.env.CONCURRENCY_START || Date.now() + 2 * 24 * 60 * 60 * 1000);
  startDate.setUTCHours(10, 0, 0, 0);
  const start = startDate.toISOString();
  const end = new Date(startDate.getTime() + 60 * 60 * 1000).toISOString();
  const headers = { authorization: `Bearer ${token}` };
  const searchResponse = await fetch(`${baseUrl}/api/venues/search?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, { headers });
  if (!searchResponse.ok) throw new Error(`Concurrency fixture search failed: HTTP ${searchResponse.status}`);
  const search = await searchResponse.json() as { rooms: Array<{ id: string; venueId: string }> };
  const venueRooms = search.rooms.filter((room) => room.venueId === venueId);
  const roomId = process.env.CONCURRENCY_ROOM_ID || venueRooms[0]?.id;
  if (!roomId) throw new Error('Concurrency fixture found no available room');
  const selectedRoom = venueRooms.find((room) => room.id === roomId) || venueRooms[0];
  const adminLoginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.CONCURRENCY_ADMIN_EMAIL || 'admin-a@atrium.local', password: process.env.CONCURRENCY_PASSWORD || 'Password123!' }),
  });
  if (!adminLoginResponse.ok) throw new Error(`Concurrency fixture admin login failed: HTTP ${adminLoginResponse.status}`);
  const adminLogin = await adminLoginResponse.json() as { token: string };
  const equipmentResponse = await fetch(`${baseUrl}/api/venues/${selectedRoom.venueId}/equipment`, { headers: { authorization: `Bearer ${adminLogin.token}` } });
  if (!equipmentResponse.ok) throw new Error(`Concurrency fixture equipment lookup failed: HTTP ${equipmentResponse.status}`);
  const equipment = await equipmentResponse.json() as { equipment: Array<{ id: string; totalUnits: number }> };
  const equipmentId = process.env.CONCURRENCY_EQUIPMENT_ID || equipment.equipment.find((item) => item.totalUnits === 3)?.id;
  if (!equipmentId) throw new Error('Concurrency fixture found no equipment type with three units');
  const equipmentRoomIds = (process.env.CONCURRENCY_EQUIPMENT_ROOM_IDS || venueRooms.map((room) => room.id).filter((id) => id !== roomId).slice(0, 3).join(','))
    .split(',').map((id) => id.trim()).filter(Boolean);
  if (equipmentRoomIds.length === 0) throw new Error('Concurrency fixture found no equipment rooms');
  return { token, roomId, start, end, equipmentId, equipmentRoomIds };
}

async function postHold(fixture: ProofFixture, targetRoomId: string, equipment: Array<{ equipmentTypeId: string; quantity: number }> = []) {
  const response = await fetch(`${baseUrl}/api/bookings/holds`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${fixture.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ roomId: targetRoomId, start: fixture.start, end: fixture.end, equipment }),
  });

  return { status: response.status, body: await response.json() as unknown };
}

describe('MANDATORY THREE-REPLICA CONCURRENCY PROOF', () => {
  it('allows exactly one active hold for 200 requests to the same room slot', async () => {
    const fixture = await discoverFixture();
    const responses = await Promise.all(Array.from({ length: 200 }, () => postHold(fixture, fixture.roomId)));
    const successes = responses.filter((response) => response.status === 201);
    const conflicts = responses.filter((response) => response.status === 409);
    const unexpected = responses.filter((response) => ![201, 409].includes(response.status));

    console.log('Room proof counts', { successes: successes.length, conflicts: conflicts.length, unexpected: unexpected.length, samples: unexpected.slice(0, 5) });
    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(199);
    expect(unexpected).toHaveLength(0);
  });

  it('never reserves more than three equipment units across 200 requests', async () => {
    const fixture = await discoverFixture();
    const responses = await Promise.all(Array.from({ length: 200 }, (_, index) => postHold(
      fixture,
      fixture.equipmentRoomIds[index % fixture.equipmentRoomIds.length],
      [{ equipmentTypeId: fixture.equipmentId, quantity: 1 }],
    )));
    const successes = responses.filter((response) => response.status === 201);
    const conflicts = responses.filter((response) => response.status === 409);
    const unexpected = responses.filter((response) => ![201, 409].includes(response.status));

    console.log('Equipment proof counts', { successes: successes.length, conflicts: conflicts.length, unexpected: unexpected.length, samples: JSON.stringify(unexpected.slice(0, 5)) });
    expect(successes.length).toBeLessThanOrEqual(3);
    expect(conflicts.length + successes.length).toBe(200);
    expect(unexpected).toHaveLength(0);
  });
});
