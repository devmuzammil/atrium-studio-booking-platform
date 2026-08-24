import 'dotenv/config';
import { createHmac } from 'crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { BookingStatus, Prisma, UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';
import { AuthDependencies } from '../src/middleware/auth';
import { PaymentProvider } from '../src/services/paymentService';
import { completeDueBookings } from '../src/services/bookingCompletionService';
import { beginCheckout } from '../src/services/checkoutService';

jest.setTimeout(30000);
process.env.PAYGATE_SECRET = 'happy-path-secret';
process.env.PAYGATE_CHAOS = 'off';

const userId = randomUUID();
const venueId = randomUUID();
const roomId = randomUUID();
const jwtSecret = 'happy-path-jwt';
const auth: AuthDependencies = {
  jwtSecret,
  findUser: async (id) => id === userId ? { id: userId, roles: [{ role: UserRole.CUSTOMER, venueId }] } : null,
};
const provider: PaymentProvider = {
  charge: jest.fn().mockResolvedValue({ chargeId: 'ch_happy_path' }),
  refund: jest.fn().mockResolvedValue({ refundId: 're_happy_path' }),
};
const app = createApp({ auth, paymentProvider: provider });
const token = jwt.sign({ sub: userId }, jwtSecret);
const start = new Date();
start.setUTCDate(start.getUTCDate() + 1);
start.setUTCHours(10, 0, 0, 0);
const end = new Date(start.getTime() + 60 * 60000);
const allDaySchedule = Object.fromEntries(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  .map((day) => [day, [{ open: '00:00', close: '23:59' }]]));

beforeAll(async () => {
  await prisma.user.create({ data: { id: userId, email: `${userId}@happy.test`, passwordHash: 'test' } });
  await prisma.venue.create({ data: { id: venueId, name: 'Happy Venue', city: 'Karachi', timezone: 'UTC', operatingSchedule: allDaySchedule } });
  await prisma.room.create({ data: { id: roomId, venueId, name: 'Happy Room', capacity: 4, hourlyRateMinor: 12500, amenities: [] } });
});

afterEach(async () => {
  await prisma.$executeRaw(Prisma.sql`TRUNCATE TABLE audit_events, refunds, payment_events, payments, inventory_reservations, booking_line_items, bookings, cancellation_policies RESTART IDENTITY CASCADE;`);
});

afterAll(async () => {
  await prisma.room.delete({ where: { id: roomId } });
  await prisma.venue.delete({ where: { id: venueId } });
  await prisma.user.delete({ where: { id: userId } });
});

describe('end-to-end happy path', () => {
  it('holds, opens checkout, pays, confirms, and reconciles', async () => {
    const hold = await request(app)
      .post('/api/bookings/holds')
      .set('Authorization', `Bearer ${token}`)
      .send({ roomId, start: start.toISOString(), end: end.toISOString(), equipment: [] });

    expect(hold.status).toBe(201);
    const bookingId = hold.body.booking.id as string;

    const checkout = await request(app)
      .post(`/api/bookings/${bookingId}/checkout`)
      .set('Authorization', `Bearer ${token}`);
    expect(checkout.status).toBe(200);
    expect(new Date(checkout.body.booking.checkoutDeadline).getTime()).toBeGreaterThan(Date.now() + 9 * 60 * 1000);

    const payment = await request(app)
      .post(`/api/bookings/${bookingId}/payment`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'happy-path-key');
    expect(payment.status).toBe(202);

    const body = {
      charge_id: 'ch_happy_path',
      reference: bookingId,
      event: 'charge.succeeded',
      amount_minor: hold.body.booking.amountMinor,
      currency: 'PKR',
      occurred_at: new Date().toISOString(),
    };
    const raw = JSON.stringify(body);
    const signature = createHmac('sha256', process.env.PAYGATE_SECRET as string).update(raw).digest('hex');
    const webhook = await request(app)
      .post('/api/paygate/webhook')
      .set('content-type', 'application/json')
      .set('x-paygate-signature', signature)
      .set('x-paygate-delivery', randomUUID())
      .send(raw);
    expect(webhook.status).toBe(200);

    const detail = await request(app)
      .get(`/api/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.status).toBe(BookingStatus.CONFIRMED);
  });
});

describe('checkout window', () => {
  it('rejects checkout after the eight-minute hold TTL', async () => {
    const bookingId = randomUUID();
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO bookings (
        id, user_id, room_id, slot, protected_slot, status, amount_minor, currency,
        pricing_snapshot, policy_snapshot, hold_expires_at, checkout_deadline, created_at, updated_at
      ) VALUES (
        ${bookingId}::uuid, ${userId}::uuid, ${roomId}::uuid,
        tstzrange(${start}, ${end}, '[)'), tstzrange(${start}, ${end}, '[)'),
        'HELD'::"BookingStatus", 10000, 'PKR', '{}'::jsonb, '{}'::jsonb,
        ${new Date(Date.now() - 1000)}, ${new Date(Date.now() + 60000)}, now(), now()
      )
    `);

    await expect(beginCheckout(prisma, userId, bookingId)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('booking completion', () => {
  it('moves a confirmed booking whose slot has ended to COMPLETED', async () => {
    const bookingId = randomUUID();
    const pastStart = new Date('2024-01-01T10:00:00.000Z');
    const pastEnd = new Date('2024-01-01T11:00:00.000Z');
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO bookings (
        id, user_id, room_id, slot, protected_slot, status, amount_minor, currency,
        pricing_snapshot, policy_snapshot, created_at, updated_at
      ) VALUES (
        ${bookingId}::uuid, ${userId}::uuid, ${roomId}::uuid,
        tstzrange(${pastStart}, ${pastEnd}, '[)'), tstzrange(${pastStart}, ${pastEnd}, '[)'),
        'CONFIRMED'::"BookingStatus", 10000, 'PKR', '{}'::jsonb, '{}'::jsonb, now(), now()
      )
    `);

    const completed = await completeDueBookings(prisma);
    expect(completed).toContain(bookingId);
    expect((await prisma.booking.findUnique({ where: { id: bookingId } }))?.status).toBe(BookingStatus.COMPLETED);
  });
});
