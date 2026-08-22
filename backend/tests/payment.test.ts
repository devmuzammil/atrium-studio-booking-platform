import 'dotenv/config';
import { createHmac } from 'crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { BookingStatus, PaymentStatus, Prisma, UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';
import { AuthDependencies } from '../src/middleware/auth';
import { PaymentProvider } from '../src/services/paymentService';

jest.setTimeout(30000);
process.env.PAYGATE_SECRET = 'payment-test-secret';
process.env.PAYGATE_CALLBACK_URL = 'http://127.0.0.1:3001/paygate-test';
process.env.PAYGATE_CHAOS = 'off';

const userId = randomUUID();
const otherUserId = randomUUID();
const venueId = randomUUID();
const roomId = randomUUID();
const jwtSecret = 'payment-jwt-secret';
const auth: AuthDependencies = {
  jwtSecret,
  findUser: async (id) => id === userId
    ? { id: userId, roles: [{ role: UserRole.CUSTOMER, venueId }] }
    : id === otherUserId
      ? { id: otherUserId, roles: [{ role: UserRole.CUSTOMER, venueId }] }
      : null,
};
const provider: PaymentProvider = {
  charge: jest.fn().mockResolvedValue({ chargeId: 'ch_payment_test' }),
  refund: jest.fn().mockResolvedValue({ refundId: 're_payment_test' }),
};
const app = createApp({ auth, paymentProvider: provider });
const token = jwt.sign({ sub: userId }, jwtSecret);
const start = new Date(Date.now() + 2 * 60 * 60 * 1000);
start.setUTCMinutes(Math.ceil(start.getUTCMinutes() / 30) * 30, 0, 0);
const end = new Date(start.getTime() + 60 * 60000);

async function createHeldBooking(status: BookingStatus = BookingStatus.HELD, ownerId = userId): Promise<string> {
  const bookingId = randomUUID();
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO bookings (
      id, user_id, room_id, slot, protected_slot, status, amount_minor, currency,
      pricing_snapshot, policy_snapshot, hold_expires_at, checkout_deadline, created_at, updated_at
    ) VALUES (
      ${bookingId}::uuid, ${ownerId}::uuid, ${roomId}::uuid,
      tstzrange(${start}, ${end}, '[)'),
      tstzrange(${start}, ${end}, '[)'), ${status}::"BookingStatus", 12500, 'PKR',
      '{}'::jsonb, '{}'::jsonb, ${new Date(Date.now() + 8 * 60000)},
      ${new Date(Date.now() + 10 * 60000)}, now(), now()
    )
  `);
  return bookingId;
}

function webhook(body: Record<string, unknown>, deliveryId = randomUUID()) {
  const raw = JSON.stringify(body);
  const signature = createHmac('sha256', process.env.PAYGATE_SECRET as string).update(raw).digest('hex');
  return request(app)
    .post('/api/paygate/webhook')
    .set('content-type', 'application/json')
    .set('x-paygate-signature', signature)
    .set('x-paygate-delivery', deliveryId)
    .send(raw);
}

beforeAll(async () => {
  await prisma.user.createMany({ data: [
    { id: userId, email: `${userId}@payment.test`, passwordHash: 'test' },
    { id: otherUserId, email: `${otherUserId}@payment.test`, passwordHash: 'test' },
  ] });
  await prisma.venue.create({ data: { id: venueId, name: 'Payment Venue', city: 'Karachi', timezone: 'UTC', operatingSchedule: {} } });
  await prisma.room.create({ data: { id: roomId, venueId, name: 'Payment Room', capacity: 4, hourlyRateMinor: 12500, amenities: [] } });
});

afterEach(async () => {
  await prisma.$executeRaw(Prisma.sql`TRUNCATE TABLE audit_events, refunds, payment_events, payments, inventory_reservations, booking_line_items, bookings RESTART IDENTITY CASCADE;`);
  await prisma.paygateCharge.deleteMany({ where: { reference: { not: '' } } });
  jest.clearAllMocks();
});

afterAll(async () => {
  await prisma.room.delete({ where: { id: roomId } });
  await prisma.venue.delete({ where: { id: venueId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.user.delete({ where: { id: otherUserId } });
});

describe('Paygate and payment integrity', () => {
  it('creates an idempotent Paygate charge and returns processing', async () => {
    const body = { amount_minor: 45000, currency: 'PKR', reference: randomUUID() };
    const first = await request(app).post('/paygate/charges').set('Idempotency-Key', 'paygate-key').send(body);
    const second = await request(app).post('/paygate/charges').set('Idempotency-Key', 'paygate-key').send(body);

    expect(first.status).toBe(202);
    expect(first.body.status).toBe('processing');
    expect(second.body.charge_id).toBe(first.body.charge_id);
    expect(await prisma.paygateCharge.count({ where: { idempotencyKey: 'paygate-key' } })).toBe(1);
  });

  it('starts payment from a held booking with the server amount', async () => {
    const bookingId = await createHeldBooking();
    const response = await request(app).post(`/api/bookings/${bookingId}/payment`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'payment-key');

    expect(response.status).toBe(202);
    expect(response.body.payment.amountMinor).toBe(12500);
    expect(provider.charge).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 12500, reference: bookingId }));
    expect((await prisma.booking.findUnique({ where: { id: bookingId } }))?.status).toBe(BookingStatus.PENDING_PAYMENT);
    expect(await prisma.auditEvent.count({ where: { bookingId, toStatus: BookingStatus.PENDING_PAYMENT } })).toBe(1);

    const retry = await request(app).post(`/api/bookings/${bookingId}/payment`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'payment-key');
    expect(retry.status).toBe(202);
    expect(provider.charge).toHaveBeenCalledTimes(1);
  });

  it('rejects payment for another customer and invalid JWT', async () => {
    const bookingId = await createHeldBooking(BookingStatus.HELD, otherUserId);
    const invalid = await request(app).post(`/api/bookings/${bookingId}/payment`).set('Authorization', 'Bearer invalid');
    const missing = await request(app).post(`/api/bookings/${bookingId}/payment`).set('Authorization', `Bearer ${token}`);
    expect(invalid.status).toBe(401);
    expect(missing.status).toBe(403);
  });

  it('confirms a successful signed webhook exactly once', async () => {
    const bookingId = await createHeldBooking();
    await request(app).post(`/api/bookings/${bookingId}/payment`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'payment-key');
    const body = { charge_id: 'ch_payment_test', reference: bookingId, event: 'charge.succeeded', amount_minor: 12500, currency: 'PKR', occurred_at: new Date().toISOString() };
    const first = await webhook(body).set('X-Request-ID', 'payment-webhook-correlation');
    const second = await webhook(body, randomUUID());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await prisma.booking.findUnique({ where: { id: bookingId } }))?.status).toBe(BookingStatus.CONFIRMED);
    expect(await prisma.auditEvent.count({ where: { bookingId, toStatus: BookingStatus.CONFIRMED } })).toBe(1);
    expect((await prisma.paymentEvent.findFirst({ where: { providerChargeId: 'ch_payment_test' } }))?.correlationId).toBe('payment-webhook-correlation');
  });

  it('rejects invalid signatures and incorrect amounts without confirmation', async () => {
    const bookingId = await createHeldBooking();
    await request(app).post(`/api/bookings/${bookingId}/payment`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'payment-key');
    const invalid = await request(app).post('/api/paygate/webhook').set('x-paygate-signature', 'bad').set('x-paygate-delivery', randomUUID()).send({ charge_id: 'ch_payment_test' });
    const incorrect = await webhook({ charge_id: 'ch_payment_test', reference: bookingId, event: 'charge.succeeded', amount_minor: 1, currency: 'PKR' });

    expect(invalid.status).toBe(401);
    expect(incorrect.status).toBe(200);
    expect((await prisma.booking.findUnique({ where: { id: bookingId } }))?.status).toBe(BookingStatus.PENDING_PAYMENT);
  });

  it('records an unknown charge webhook for recovery', async () => {
    const response = await webhook({ charge_id: 'ch_unknown', reference: randomUUID(), event: 'charge.succeeded', amount_minor: 100, currency: 'PKR' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('recorded_unknown');
    expect(await prisma.paymentEvent.count({ where: { providerChargeId: 'ch_unknown' } })).toBe(1);
  });

  it('refunds a successful payment after expiry and ignores duplicate delivery', async () => {
    const bookingId = await createHeldBooking();
    await request(app).post(`/api/bookings/${bookingId}/payment`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'payment-key');
    await prisma.booking.update({ where: { id: bookingId }, data: { status: BookingStatus.EXPIRED } });
    const body = { charge_id: 'ch_payment_test', reference: bookingId, event: 'charge.succeeded', amount_minor: 12500, currency: 'PKR' };
    await webhook(body);
    await webhook(body, randomUUID());

    expect((await prisma.booking.findUnique({ where: { id: bookingId } }))?.status).toBe(BookingStatus.REFUNDED);
    expect(await prisma.refund.count({ where: { bookingId } })).toBe(1);
    expect(provider.refund).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent duplicate webhooks to one confirmation', async () => {
    const bookingId = await createHeldBooking();
    await request(app).post(`/api/bookings/${bookingId}/payment`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'payment-key');
    const body = { charge_id: 'ch_payment_test', reference: bookingId, event: 'charge.succeeded', amount_minor: 12500, currency: 'PKR' };
    const responses = await Promise.all([webhook(body), webhook(body, randomUUID()), webhook(body, randomUUID())]);

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect((await prisma.booking.findUnique({ where: { id: bookingId } }))?.status).toBe(BookingStatus.CONFIRMED);
    expect(await prisma.auditEvent.count({ where: { bookingId, toStatus: BookingStatus.CONFIRMED } })).toBe(1);
  });
});
