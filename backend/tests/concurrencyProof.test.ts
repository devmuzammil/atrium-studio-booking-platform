import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/config/prisma';
import { randomUUID } from 'crypto';

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

interface FixtureCleanup {
  userId: string;
  venueId: string;
  roomIds: string[];
  equipmentId: string;
}

let fixture: ProofFixture;
let cleanup: FixtureCleanup;

async function createFixture(): Promise<ProofFixture> {
  const userId = randomUUID();
  const venueId = randomUUID();
  const roomIds = Array.from({ length: 4 }, () => randomUUID());
  const equipmentId = randomUUID();
  const passwordHash = 'concurrency-proof-user';
  const schedule = Object.fromEntries(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => [day, [{ open: '00:00', close: '23:59' }]]));
  const startDate = new Date(process.env.CONCURRENCY_START || Date.now() + 2 * 24 * 60 * 60 * 1000);
  startDate.setUTCHours(10, 0, 0, 0);
  const start = startDate.toISOString();
  const end = new Date(startDate.getTime() + 60 * 60 * 1000).toISOString();

  await prisma.user.create({ data: { id: userId, email: `concurrency-${userId}@atrium.local`, passwordHash } });
  await prisma.venue.create({ data: { id: venueId, name: `Concurrency Proof ${venueId}`, city: 'Proof', timezone: 'UTC', operatingSchedule: schedule } });
  await prisma.userVenueRole.create({ data: { userId, venueId, role: 'CUSTOMER' } });
  await prisma.room.createMany({ data: roomIds.map((id, index) => ({ id, venueId, name: `Proof Room ${index + 1}`, capacity: 4, hourlyRateMinor: 1000, currency: 'PKR', amenities: [] })) });
  await prisma.equipmentType.create({ data: { id: equipmentId, venueId, name: 'Proof Equipment', hourlyRateMinor: 100, currency: 'PKR', totalUnits: 3, overbookingPercent: 0 } });

  cleanup = { userId, venueId, roomIds, equipmentId };
  const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET || 'local-development-secret');
  return { token, roomId: roomIds[0], start, end, equipmentId, equipmentRoomIds: roomIds.slice(1) };
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

  let body: unknown = null;
  try { body = await response.json(); } catch { /* Preserve status evidence for non-JSON proxy errors. */ }
  return { status: response.status, instanceId: response.headers.get('x-instance-id'), body };
}

async function activeRoomBookings(roomId: string, start: string, end: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    SELECT COUNT(*)::int AS count FROM bookings
    WHERE room_id = ${roomId}::uuid
      AND status IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED')
      AND slot && tstzrange(${new Date(start)}, ${new Date(end)}, '[)')
  `);
  return rows[0]?.count ?? 0;
}

async function equipmentMaximum(equipmentId: string, start: string, end: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ maximum: number }>>(Prisma.sql`
    SELECT COALESCE(MAX(running_quantity), 0)::int AS maximum
    FROM (
      SELECT SUM(delta) OVER (ORDER BY point, delta DESC ROWS UNBOUNDED PRECEDING) AS running_quantity
      FROM (
        SELECT lower(ir.slot) AS point, ir.quantity AS delta
        FROM inventory_reservations ir INNER JOIN bookings b ON b.id = ir.booking_id
        WHERE ir.equipment_type_id = ${equipmentId}::uuid
          AND b.status IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED')
          AND ir.slot && tstzrange(${new Date(start)}, ${new Date(end)}, '[)')
        UNION ALL
        SELECT upper(ir.slot) AS point, -ir.quantity AS delta
        FROM inventory_reservations ir INNER JOIN bookings b ON b.id = ir.booking_id
        WHERE ir.equipment_type_id = ${equipmentId}::uuid
          AND b.status IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED')
          AND ir.slot && tstzrange(${new Date(start)}, ${new Date(end)}, '[)')
      ) events
    ) quantities
  `);
  return rows[0]?.maximum ?? 0;
}

async function removeFixture(): Promise<void> {
  await prisma.$executeRaw`ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only`;
  try {
    await prisma.$transaction(async (transaction) => {
      const bookingIds = await transaction.booking.findMany({ where: { roomId: { in: cleanup.roomIds } }, select: { id: true } });
      await transaction.auditEvent.deleteMany({ where: { bookingId: { in: bookingIds.map((booking) => booking.id) } } });
      await transaction.inventoryReservation.deleteMany({ where: { bookingId: { in: bookingIds.map((booking) => booking.id) } } });
      await transaction.bookingLineItem.deleteMany({ where: { bookingId: { in: bookingIds.map((booking) => booking.id) } } });
      await transaction.booking.deleteMany({ where: { id: { in: bookingIds.map((booking) => booking.id) } } });
      await transaction.equipmentType.delete({ where: { id: cleanup.equipmentId } });
      await transaction.room.deleteMany({ where: { id: { in: cleanup.roomIds } } });
      await transaction.userVenueRole.delete({ where: { userId_venueId_role: { userId: cleanup.userId, venueId: cleanup.venueId, role: 'CUSTOMER' } } });
      await transaction.venue.delete({ where: { id: cleanup.venueId } });
      await transaction.user.delete({ where: { id: cleanup.userId } });
    });
  } finally {
    await prisma.$executeRaw`ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only`;
  }
}

describe('MANDATORY THREE-REPLICA CONCURRENCY PROOF', () => {
  beforeAll(async () => { fixture = await createFixture(); });
  afterAll(async () => { await removeFixture(); await prisma.$disconnect(); });

  it('allows exactly one active hold for 200 requests to the same room slot', async () => {
    const responses = await Promise.all(Array.from({ length: 200 }, () => postHold(fixture, fixture.roomId)));
    const successes = responses.filter((response) => response.status === 201);
    const conflicts = responses.filter((response) => response.status === 409);
    const unexpected = responses.filter((response) => ![201, 409].includes(response.status));
    const persistedBookings = await activeRoomBookings(fixture.roomId, fixture.start, fixture.end);
    const replicas = [...new Set(responses.map((response) => response.instanceId).filter(Boolean))];

    console.log('Room proof counts', { requests: responses.length, successes: successes.length, conflicts: conflicts.length, unexpected: unexpected.length, persistedBookings, replicas, samples: unexpected.slice(0, 5) });
    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(199);
    expect(unexpected).toHaveLength(0);
    expect(persistedBookings).toBe(1);
    expect(replicas).toEqual(expect.arrayContaining(['api-1', 'api-2', 'api-3']));
  });

  it('never reserves more than three equipment units across 200 requests', async () => {
    const responses = await Promise.all(Array.from({ length: 200 }, (_, index) => postHold(
      fixture,
      fixture.equipmentRoomIds[index % fixture.equipmentRoomIds.length],
      [{ equipmentTypeId: fixture.equipmentId, quantity: 1 }],
    )));
    const successes = responses.filter((response) => response.status === 201);
    const conflicts = responses.filter((response) => response.status === 409);
    const unexpected = responses.filter((response) => ![201, 409].includes(response.status));
    const maximumReserved = await equipmentMaximum(fixture.equipmentId, fixture.start, fixture.end);
    const replicas = [...new Set(responses.map((response) => response.instanceId).filter(Boolean))];

    console.log('Equipment proof counts', { requests: responses.length, successes: successes.length, conflicts: conflicts.length, unexpected: unexpected.length, maximumReserved, replicas, samples: JSON.stringify(unexpected.slice(0, 5)) });
    expect(successes.length).toBeLessThanOrEqual(3);
    expect(conflicts.length + successes.length).toBe(200);
    expect(unexpected).toHaveLength(0);
    expect(maximumReserved).toBeLessThanOrEqual(3);
    expect(replicas).toEqual(expect.arrayContaining(['api-1', 'api-2', 'api-3']));
  });
});
