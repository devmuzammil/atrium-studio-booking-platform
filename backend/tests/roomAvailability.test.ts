import 'dotenv/config';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { Prisma, UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';
import { AuthDependencies } from '../src/middleware/auth';

jest.setTimeout(30000);

const jwtSecret = 'availability-test-secret';
const customerId = randomUUID();
const venueAId = randomUUID();
const venueBId = randomUUID();
const roomAId = randomUUID();
const roomBId = randomUUID();
const start = new Date('2030-01-15T10:00:00.000Z');
const end = new Date('2030-01-15T11:00:00.000Z');

const auth: AuthDependencies = {
  jwtSecret,
  findUser: async (userId) => userId === customerId
    ? { id: customerId, roles: [{ role: UserRole.CUSTOMER, venueId: venueAId }] }
    : null,
};

const app = createApp({ auth });
const token = jwt.sign({ sub: customerId }, jwtSecret);
const activeStatuses = ['HELD', 'PENDING_PAYMENT', 'CONFIRMED'] as const;

async function createBooking(status: string, bookingStart = start, bookingEnd = end): Promise<string> {
  const bookingId = randomUUID();
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO bookings (
      id, user_id, room_id, slot, protected_slot, status, amount_minor,
      currency, pricing_snapshot, policy_snapshot, created_at, updated_at
    ) VALUES (
      ${bookingId}::uuid, ${customerId}::uuid, ${roomAId}::uuid,
      tstzrange(${bookingStart}, ${bookingEnd}, '[)'),
      tstzrange(${bookingStart}, ${bookingEnd} + interval '15 minutes', '[)'),
      ${Prisma.raw(`'${status}'::"BookingStatus"`)}, 10000, 'PKR', '{}'::jsonb,
      '{}'::jsonb, now(), now()
    )
  `);
  return bookingId;
}

async function search(query: Record<string, string> = {}) {
  return request(app)
    .get('/api/venues/search')
    .set('Authorization', `Bearer ${token}`)
    .query({ start: start.toISOString(), end: end.toISOString(), ...query });
}

beforeAll(async () => {
  await prisma.$executeRaw(Prisma.sql`
    TRUNCATE TABLE
      audit_events,
      paygate_refunds,
      paygate_charges,
      payment_events,
      payments,
      refunds,
      inventory_reservations,
      booking_line_items,
      bookings,
      cancellation_policies,
      user_venue_roles,
      equipment_types,
      rooms,
      venues,
      users
    RESTART IDENTITY CASCADE;
  `);
  await prisma.user.create({ data: { id: customerId, email: `${customerId}@test.local`, passwordHash: 'test' } });
  await prisma.venue.create({
    data: {
      id: venueAId,
      name: 'Venue A',
      city: 'Karachi',
      timezone: 'Asia/Karachi',
      operatingSchedule: {},
    },
  });
  await prisma.venue.create({
    data: {
      id: venueBId,
      name: 'Venue B',
      city: 'Dubai',
      timezone: 'Asia/Dubai',
      operatingSchedule: {},
    },
  });
  await prisma.room.create({
    data: {
      id: roomAId,
      venueId: venueAId,
      name: 'Quiet Room',
      capacity: 4,
      hourlyRateMinor: 100,
      amenities: ['quiet', 'daylight'],
    },
  });
  await prisma.room.create({
    data: {
      id: roomBId,
      venueId: venueBId,
      name: 'Bright Room',
      capacity: 8,
      hourlyRateMinor: 200,
      amenities: ['daylight', 'soundproof'],
    },
  });
});

afterAll(async () => {
  await prisma.$executeRaw(Prisma.sql`TRUNCATE TABLE audit_events, paygate_refunds, paygate_charges, payment_events, payments, refunds, inventory_reservations, booking_line_items, bookings, cancellation_policies, user_venue_roles, equipment_types, rooms, venues, users RESTART IDENTITY CASCADE;`);
});

afterEach(async () => {
  await prisma.$executeRaw(Prisma.sql`TRUNCATE TABLE audit_events, paygate_refunds, paygate_charges, payment_events, payments, refunds, inventory_reservations, booking_line_items, bookings, cancellation_policies, user_venue_roles, equipment_types, rooms, venues, users RESTART IDENTITY CASCADE;`);
  await prisma.user.create({ data: { id: customerId, email: `${customerId}@test.local`, passwordHash: 'test' } });
  await prisma.venue.create({
    data: {
      id: venueAId,
      name: 'Venue A',
      city: 'Karachi',
      timezone: 'Asia/Karachi',
      operatingSchedule: {},
    },
  });
  await prisma.venue.create({
    data: {
      id: venueBId,
      name: 'Venue B',
      city: 'Dubai',
      timezone: 'Asia/Dubai',
      operatingSchedule: {},
    },
  });
  await prisma.room.create({
    data: {
      id: roomAId,
      venueId: venueAId,
      name: 'Quiet Room',
      capacity: 4,
      hourlyRateMinor: 100,
      amenities: ['quiet', 'daylight'],
    },
  });
  await prisma.room.create({
    data: {
      id: roomBId,
      venueId: venueBId,
      name: 'Bright Room',
      capacity: 8,
      hourlyRateMinor: 200,
      amenities: ['daylight', 'soundproof'],
    },
  });
});

describe('room availability and cross-venue search', () => {
  it('returns an available room for a free interval', async () => {
    const response = await search();

    expect(response.status).toBe(200);
    expect(response.body.rooms.map((room: { id: string }) => room.id).sort()).toEqual([roomBId, roomAId].sort());
  });

  it('does not return a soft-deleted room', async () => {
    await prisma.room.update({ where: { id: roomAId }, data: { deletedAt: new Date() } });

    const response = await search();

    expect(response.status).toBe(200);
    expect(response.body.rooms.map((room: { id: string }) => room.id)).toEqual([roomBId]);
  });

  it.each(activeStatuses)('excludes a %s overlapping booking', async (status) => {
    await createBooking(status);

    const response = await search({ city: 'Karachi' });

    expect(response.status).toBe(200);
    expect(response.body.rooms).toEqual([]);
  });

  it.each(['EXPIRED', 'FAILED', 'CANCELLED', 'REFUNDED'])('does not exclude a %s booking', async (status) => {
    await createBooking(status);

    const response = await search({ city: 'Karachi' });

    expect(response.status).toBe(200);
    expect(response.body.rooms.map((room: { id: string }) => room.id)).toEqual([roomAId]);
  });

  it('requires the full 15-minute turnaround after an existing booking', async () => {
    await createBooking('CONFIRMED');

    const exactBoundary = await search({
      start: '2030-01-15T11:00:00.000Z',
      end: '2030-01-15T12:00:00.000Z',
      city: 'Karachi',
    });
    const afterTurnaround = await search({
      start: '2030-01-15T11:15:00.000Z',
      end: '2030-01-15T12:15:00.000Z',
      city: 'Karachi',
    });

    expect(exactBoundary.body.rooms).toEqual([]);
    expect(afterTurnaround.body.rooms.map((room: { id: string }) => room.id)).toEqual([roomAId]);
  });

  it('handles a request ending exactly at the next booking start', async () => {
    await createBooking('CONFIRMED', new Date('2030-01-15T12:00:00.000Z'), new Date('2030-01-15T13:00:00.000Z'));

    const response = await search({
      start: '2030-01-15T10:45:00.000Z',
      end: '2030-01-15T11:45:00.000Z',
      city: 'Karachi',
    });

    expect(response.body.rooms.map((room: { id: string }) => room.id)).toEqual([roomAId]);
  });

  it('applies city, capacity, price, and all-amenity filters together', async () => {
    const response = await search({
      city: 'Karachi',
      minCapacity: '4',
      maxPrice: '100',
      amenities: 'quiet,daylight',
    });

    expect(response.body.rooms.map((room: { id: string }) => room.id)).toEqual([roomAId]);

    const partialAmenityMatch = await search({ city: 'Dubai', amenities: 'daylight,quiet' });
    expect(partialAmenityMatch.body.rooms).toEqual([]);
  });

  it('returns matching rooms across multiple venues', async () => {
    const response = await search({ amenities: 'daylight' });

    expect(response.body.rooms.map((room: { venueId: string }) => room.venueId).sort()).toEqual([venueAId, venueBId].sort());
  });

  it.each([
    [{ start: 'not-a-date' }, 'must be a valid timestamp'],
    [{ start: end.toISOString(), end: start.toISOString() }, 'start must be before end'],
    [{ minCapacity: '0' }, 'minCapacity must be an integer'],
    [{ maxPrice: '-1' }, 'maxPrice must be an integer'],
    [{ start: '2030-01-01T00:00:00Z', end: '2030-01-09T00:00:00Z' }, 'cannot exceed 7 days'],
  ])('rejects invalid search input', async (query, error) => {
    const response = await search(query);

    expect(response.status).toBe(400);
    expect(response.body.error).toContain(error);
  });

  it('requires authentication', async () => {
    const response = await request(app).get('/api/venues/search').query({
      start: start.toISOString(),
      end: end.toISOString(),
    });

    expect(response.status).toBe(401);
  });
});