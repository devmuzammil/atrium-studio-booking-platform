import 'dotenv/config';
import { BookingStatus, Prisma, UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import { prisma } from '../src/config/prisma';
import { expireDueHolds, expireHold } from '../src/services/holdExpiryService';
import { PaymentProvider, processPaymentWebhook } from '../src/services/paymentService';

jest.setTimeout(30000);

const userId = randomUUID();
const venueId = randomUUID();
const roomId = randomUUID();
const start = new Date(Date.now() + 2 * 60 * 60 * 1000);
start.setUTCMinutes(Math.ceil(start.getUTCMinutes() / 30) * 30, 0, 0);
const end = new Date(start.getTime() + 60 * 60000);
const authRole = { role: UserRole.CUSTOMER, venueId };
void authRole;

async function createBooking(status: BookingStatus, expiresAt = new Date(Date.now() - 1000)): Promise<string> {
  const bookingId = randomUUID();
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO bookings (
      id, user_id, room_id, slot, protected_slot, status, amount_minor, currency,
      pricing_snapshot, policy_snapshot, hold_expires_at, checkout_deadline, created_at, updated_at
    ) VALUES (
      ${bookingId}::uuid, ${userId}::uuid, ${roomId}::uuid,
      tstzrange(${start}, ${end}, '[)'), tstzrange(${start}, ${end}, '[)'),
      ${status}::"BookingStatus", 10000, 'PKR', '{}'::jsonb, '{}'::jsonb,
      ${expiresAt}, ${new Date(expiresAt.getTime() + 60000)}, now(), now()
    )
  `);
  return bookingId;
}

beforeAll(async () => {
  await prisma.user.create({ data: { id: userId, email: `${userId}@expiry.test`, passwordHash: 'test' } });
  await prisma.venue.create({ data: { id: venueId, name: 'Expiry Venue', city: 'Karachi', timezone: 'UTC', operatingSchedule: {} } });
  await prisma.room.create({ data: { id: roomId, venueId, name: 'Expiry Room', capacity: 4, hourlyRateMinor: 10000, amenities: [] } });
});

afterEach(async () => {
  await prisma.$executeRaw(Prisma.sql`TRUNCATE TABLE audit_events, refunds, payment_events, payments, inventory_reservations, booking_line_items, bookings RESTART IDENTITY CASCADE;`);
});

afterAll(async () => {
  await prisma.room.delete({ where: { id: roomId } });
  await prisma.venue.delete({ where: { id: venueId } });
  await prisma.user.delete({ where: { id: userId } });
});

describe('hold expiry worker', () => {
  it('transitions a due HELD booking to EXPIRED with one audit event', async () => {
    const bookingId = await createBooking(BookingStatus.HELD);

    const result = await expireDueHolds(prisma);

    expect(result).toEqual([{ bookingId, expired: true }]);
    expect((await prisma.booking.findUnique({ where: { id: bookingId } }))?.status).toBe(BookingStatus.EXPIRED);
    expect(await prisma.auditEvent.count({ where: { bookingId, toStatus: BookingStatus.EXPIRED } })).toBe(1);
  });

  it('releases room inventory through the active-status predicate', async () => {
    const bookingId = await createBooking(BookingStatus.HELD);
    await expireHold(prisma, bookingId);

    const blocking = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*) AS count FROM bookings
      WHERE room_id = ${roomId}::uuid AND status IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED')
    `);

    expect(Number(blocking[0].count)).toBe(0);
  });

  it('is idempotent when run twice', async () => {
    const bookingId = await createBooking(BookingStatus.HELD);

    await expireHold(prisma, bookingId);
    const second = await expireHold(prisma, bookingId);

    expect(second).toEqual({ bookingId, expired: false });
    expect(await prisma.auditEvent.count({ where: { bookingId, toStatus: BookingStatus.EXPIRED } })).toBe(1);
  });

  it('allows only one of two concurrent expiry attempts to transition', async () => {
    const bookingId = await createBooking(BookingStatus.HELD);

    const results = await Promise.all([expireHold(prisma, bookingId), expireHold(prisma, bookingId)]);

    expect(results.filter((result) => result.expired)).toHaveLength(1);
    expect(await prisma.auditEvent.count({ where: { bookingId, toStatus: BookingStatus.EXPIRED } })).toBe(1);
  });

  it.each([BookingStatus.CONFIRMED, BookingStatus.EXPIRED])('does not process %s bookings', async (status) => {
    const bookingId = await createBooking(status);

    const result = await expireHold(prisma, bookingId);

    expect(result.expired).toBe(false);
    expect(await prisma.auditEvent.count({ where: { bookingId, toStatus: BookingStatus.EXPIRED } })).toBe(0);
  });

  it('expires PENDING_PAYMENT bookings whose hold TTL elapsed', async () => {
    const bookingId = await createBooking(BookingStatus.PENDING_PAYMENT);
    await prisma.payment.create({
      data: { bookingId, idempotencyKey: randomUUID(), providerChargeId: 'ch_pending_expiry', amountMinor: 10000, currency: 'PKR', status: 'PROCESSING' },
    });

    const result = await expireHold(prisma, bookingId);

    expect(result.expired).toBe(true);
    expect((await prisma.booking.findUnique({ where: { id: bookingId } }))?.status).toBe(BookingStatus.EXPIRED);
    expect(await prisma.auditEvent.count({ where: { bookingId, fromStatus: BookingStatus.PENDING_PAYMENT, toStatus: BookingStatus.EXPIRED } })).toBe(1);
  });

  it('keeps an expired booking unconfirmable when payment succeeds later', async () => {
    const bookingId = await createBooking(BookingStatus.HELD);
    await prisma.payment.create({ data: { bookingId, idempotencyKey: randomUUID(), providerChargeId: 'ch_expiry_test', amountMinor: 10000, currency: 'PKR', status: 'PROCESSING' } });
    await expireHold(prisma, bookingId);

    const provider: PaymentProvider = { charge: jest.fn(), refund: jest.fn().mockResolvedValue({ refundId: 're_expiry_test' }) };
    const result = await processPaymentWebhook(prisma, { deliveryId: randomUUID(), chargeId: 'ch_expiry_test', reference: bookingId, event: 'charge.succeeded', amountMinor: 10000, currency: 'PKR' }, provider);

    expect(result.status).toBe('refund_required');
    expect((await prisma.booking.findUnique({ where: { id: bookingId } }))?.status).toBe(BookingStatus.REFUNDED);
    expect(provider.refund).toHaveBeenCalledTimes(1);
  });
});