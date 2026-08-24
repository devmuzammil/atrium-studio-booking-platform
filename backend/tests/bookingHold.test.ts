import 'dotenv/config';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { BookingStatus, Prisma, UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';
import { AuthDependencies } from '../src/middleware/auth';

jest.setTimeout(30000);

const jwtSecret = 'hold-test-secret';
const userId = randomUUID();
const venueId = randomUUID();
const otherVenueId = randomUUID();
const roomId = randomUUID();
const otherRoomId = randomUUID();
const equipmentId = randomUUID();
const otherEquipmentId = randomUUID();
const bookingStart = new Date();
bookingStart.setUTCDate(bookingStart.getUTCDate() + 2);
bookingStart.setUTCHours(10, 0, 0, 0);
const bookingEnd = new Date(bookingStart.getTime() + 60 * 60 * 1000);
const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(bookingStart);
const allDaySchedule = { [weekday]: [{ open: '00:00', close: '23:59' }] };

const auth: AuthDependencies = {
  jwtSecret,
  findUser: async (id) => id === userId
    ? { id: userId, roles: [{ role: UserRole.CUSTOMER, venueId }] }
    : null,
};
const app = createApp({ auth });
const token = jwt.sign({ sub: userId }, jwtSecret);

function hold(payload: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/bookings/holds')
    .set('Authorization', `Bearer ${token}`)
    .send({
      roomId,
      start: bookingStart.toISOString(),
      end: bookingEnd.toISOString(),
      equipment: [],
      ...payload,
    });
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
  await prisma.user.create({ data: { id: userId, email: `${userId}@hold.test`, passwordHash: 'test' } });
  await prisma.venue.create({
    data: { id: venueId, name: 'Hold Venue', city: 'Karachi', timezone: 'UTC', operatingSchedule: allDaySchedule },
  });
  await prisma.venue.create({
    data: { id: otherVenueId, name: 'Other Venue', city: 'Dubai', timezone: 'UTC', operatingSchedule: allDaySchedule },
  });
  await prisma.room.create({
    data: { id: roomId, venueId, name: 'Hold Room', capacity: 4, hourlyRateMinor: 1000, amenities: [] },
  });
  await prisma.room.create({
    data: { id: otherRoomId, venueId: otherVenueId, name: 'Other Room', capacity: 4, hourlyRateMinor: 1000, amenities: [] },
  });
  await prisma.equipmentType.create({
    data: { id: equipmentId, venueId, name: 'Camera', hourlyRateMinor: 100, totalUnits: 3, overbookingPercent: 0 },
  });
  await prisma.equipmentType.create({
    data: { id: otherEquipmentId, venueId: otherVenueId, name: 'Other Camera', hourlyRateMinor: 100, totalUnits: 3, overbookingPercent: 0 },
  });
});

afterEach(async () => {
  await prisma.$executeRaw(Prisma.sql`TRUNCATE TABLE audit_events, paygate_refunds, paygate_charges, payment_events, payments, refunds, inventory_reservations, booking_line_items, bookings, cancellation_policies, user_venue_roles, equipment_types, rooms, venues, users RESTART IDENTITY CASCADE;`);
  await prisma.user.create({ data: { id: userId, email: `${userId}@hold.test`, passwordHash: 'test' } });
  await prisma.venue.create({
    data: { id: venueId, name: 'Hold Venue', city: 'Karachi', timezone: 'UTC', operatingSchedule: allDaySchedule },
  });
  await prisma.venue.create({
    data: { id: otherVenueId, name: 'Other Venue', city: 'Dubai', timezone: 'UTC', operatingSchedule: allDaySchedule },
  });
  await prisma.room.create({
    data: { id: roomId, venueId, name: 'Hold Room', capacity: 4, hourlyRateMinor: 1000, amenities: [] },
  });
  await prisma.room.create({
    data: { id: otherRoomId, venueId: otherVenueId, name: 'Other Room', capacity: 4, hourlyRateMinor: 1000, amenities: [] },
  });
  await prisma.equipmentType.create({
    data: { id: equipmentId, venueId, name: 'Camera', hourlyRateMinor: 100, totalUnits: 3, overbookingPercent: 0 },
  });
  await prisma.equipmentType.create({
    data: { id: otherEquipmentId, venueId: otherVenueId, name: 'Other Camera', hourlyRateMinor: 100, totalUnits: 3, overbookingPercent: 0 },
  });
});

afterAll(async () => {
  await prisma.$executeRaw(Prisma.sql`TRUNCATE TABLE audit_events, paygate_refunds, paygate_charges, payment_events, payments, refunds, inventory_reservations, booking_line_items, bookings, cancellation_policies, user_venue_roles, equipment_types, rooms, venues, users RESTART IDENTITY CASCADE;`);
});

describe('POST /api/bookings/holds', () => {
  it('creates a valid hold with an eight-minute TTL and one audit event', async () => {
    const before = Date.now();
    const response = await hold();

    expect(response.status).toBe(201);
    expect(response.body.booking.status).toBe('HELD');
    expect(new Date(response.body.booking.holdExpiresAt).getTime()).toBeGreaterThanOrEqual(before + 7 * 60 * 1000);
    expect(new Date(response.body.booking.holdExpiresAt).getTime()).toBeLessThanOrEqual(before + 9 * 60 * 1000);

    const bookingId = response.body.booking.id as string;
    const auditEvents = await prisma.auditEvent.findMany({ where: { bookingId } });
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]).toMatchObject({
      actorId: userId,
      fromStatus: BookingStatus.DRAFT,
      toStatus: BookingStatus.HELD,
      reason: 'booking hold created',
    });
  });

  it('rejects an invalid JWT', async () => {
    const response = await request(app)
      .post('/api/bookings/holds')
      .set('Authorization', 'Bearer invalid')
      .send({ roomId, start: bookingStart.toISOString(), end: bookingEnd.toISOString() });

    expect(response.status).toBe(401);
  });

  it('rejects a room belonging to another venue', async () => {
    const response = await hold({ roomId: otherRoomId });

    expect(response.status).toBe(403);
  });

  it.each([
    [30, 60, 'booking duration must be between 1 and 8 hours'],
    [60, 10 * 60, 'booking duration must be between 1 and 8 hours'],
  ])('rejects duration outside the allowed range', async (startMinutes, endMinutes, message) => {
    const response = await hold({
      start: new Date(bookingStart.getTime() + startMinutes * 60000).toISOString(),
      end: new Date(bookingStart.getTime() + endMinutes * 60000).toISOString(),
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain(message);
  });

  it('rejects non-30-minute times', async () => {
    const response = await hold({
      start: new Date(bookingStart.getTime() + 15 * 60000).toISOString(),
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('30-minute');
  });

  it('rejects a booking outside venue operating hours', async () => {
    await prisma.venue.update({ where: { id: venueId }, data: { operatingSchedule: {} } });

    const response = await hold();

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('operating hours');
    await prisma.venue.update({ where: { id: venueId }, data: { operatingSchedule: allDaySchedule } });
  });

  it('rejects an equipment type belonging to another venue', async () => {
    const response = await hold({ equipment: [{ equipmentTypeId: otherEquipmentId, quantity: 1 }] });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('room venue');
  });

  it('rejects equipment quantity above available capacity and leaves no booking', async () => {
    const response = await hold({ equipment: [{ equipmentTypeId: equipmentId, quantity: 4 }] });

    expect(response.status).toBe(409);
    expect(await prisma.booking.count({ where: { userId } })).toBe(0);
  });

  it('rejects a second overlapping room hold with 409', async () => {
    const first = await hold();
    expect(first.status).toBe(201);

    const second = await hold();

    expect(second.status).toBe(409);
    expect(await prisma.booking.count({ where: { userId, status: BookingStatus.HELD } })).toBe(1);
  });

  it('enforces the 15-minute turnaround gap', async () => {
    const first = await hold();
    expect(first.status).toBe(201);

    const adjacent = await hold({
      start: bookingEnd.toISOString(),
      end: new Date(bookingEnd.getTime() + 60 * 60000).toISOString(),
    });
    const afterTurnaround = await hold({
      start: new Date(bookingEnd.getTime() + 30 * 60000).toISOString(),
      end: new Date(bookingEnd.getTime() + 90 * 60000).toISOString(),
    });

    expect(adjacent.status).toBe(409);
    expect(afterTurnaround.status).toBe(201);
  });

  it('creates an equipment reservation atomically with the room hold', async () => {
    const response = await hold({ equipment: [{ equipmentTypeId: equipmentId, quantity: 2 }] });

    expect(response.status).toBe(201);
    const bookingId = response.body.booking.id as string;
    expect(await prisma.bookingLineItem.count({ where: { bookingId } })).toBe(1);
    expect(await prisma.inventoryReservation.count({ where: { bookingId } })).toBe(1);
  });

  it('rejects missing required input cleanly', async () => {
    const response = await request(app)
      .post('/api/bookings/holds')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(400);
  });
});
