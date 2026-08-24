import 'dotenv/config';
import { BookingStatus, PaymentStatus, Prisma, UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import { getVenueReport } from '../src/services/reportService';
import { getReconciliation } from '../src/services/reconciliationService';
import { prisma } from '../src/config/prisma';

jest.setTimeout(30000);

const venueId = randomUUID();
const otherVenueId = randomUUID();
const userId = randomUUID();
const roomId = randomUUID();
const otherRoomId = randomUUID();
const chargeIds: string[] = [];
const bookingIds: string[] = [];
const base = new Date('2026-01-01T00:00:00.000Z');
const slot = (hours: number, duration: number): { start: Date; end: Date } => ({
  start: new Date(base.getTime() + hours * 60 * 60000),
  end: new Date(base.getTime() + (hours + duration) * 60 * 60000),
});

async function createBooking(status: BookingStatus, amountMinor: number, interval: { start: Date; end: Date }): Promise<string> {
  const id = randomUUID();
  bookingIds.push(id);
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO bookings (id, user_id, room_id, slot, protected_slot, status, amount_minor, currency,
      pricing_snapshot, policy_snapshot, created_at, updated_at)
    VALUES (${id}::uuid, ${userId}::uuid, ${roomId}::uuid,
      tstzrange(${interval.start}, ${interval.end}, '[)'), tstzrange(${interval.start}, ${interval.end}, '[)'),
      ${status}::"BookingStatus", ${amountMinor}, 'PKR', '{}'::jsonb, '{}'::jsonb, now(), now())
  `);
  return id;
}

async function createPayment(bookingId: string, amountMinor: number, status: PaymentStatus, chargeId: string): Promise<void> {
  chargeIds.push(chargeId);
  await prisma.payment.create({
    data: {
      bookingId,
      idempotencyKey: randomUUID(),
      providerChargeId: chargeId,
      amountMinor,
      currency: 'PKR',
      status,
    },
  });
  await prisma.paygateCharge.create({
    data: {
      chargeId,
      idempotencyKey: randomUUID(),
      reference: bookingId,
      amountMinor,
      currency: 'PKR',
      status: 'SUCCEEDED',
    },
  });
}

async function cleanFixtures(): Promise<void> {
  if (bookingIds.length > 0) {
    if (process.env.NODE_ENV !== 'test') throw new Error('Fixture cleanup is test-only');
    await prisma.$transaction(async (transaction) => {
      await transaction.refund.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await transaction.paymentEvent.deleteMany({ where: { providerChargeId: { in: chargeIds } } });
      await transaction.paygateRefund.deleteMany({ where: { chargeId: { in: chargeIds } } });
      await transaction.paygateCharge.deleteMany({ where: { chargeId: { in: chargeIds } } });
      await transaction.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await transaction.inventoryReservation.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await transaction.bookingLineItem.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await transaction.$executeRaw`ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only`;
      try {
        await transaction.auditEvent.deleteMany({ where: { bookingId: { in: bookingIds } } });
        await transaction.booking.deleteMany({ where: { id: { in: bookingIds } } });
      } finally {
        await transaction.$executeRaw`ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only`;
      }
    });
  }
  chargeIds.length = 0;
  bookingIds.length = 0;
}

beforeAll(async () => {
  await prisma.user.create({ data: { id: userId, email: `${userId}@report-integrity.test`, passwordHash: 'test' } });
  await prisma.venue.createMany({ data: [
    { id: venueId, name: 'Report Venue', city: 'Karachi', timezone: 'UTC', operatingSchedule: {} },
    { id: otherVenueId, name: 'Other Report Venue', city: 'Dubai', timezone: 'UTC', operatingSchedule: {} },
  ] });
  await prisma.room.createMany({ data: [
    { id: roomId, venueId, name: 'Report Room', capacity: 4, hourlyRateMinor: 1000, amenities: [] },
    { id: otherRoomId, venueId: otherVenueId, name: 'Other Report Room', capacity: 4, hourlyRateMinor: 1000, amenities: [] },
  ] });
});

afterEach(async () => {
  await cleanFixtures();
});

afterAll(async () => {
  await cleanFixtures();
  await prisma.room.deleteMany({ where: { id: { in: [roomId, otherRoomId] } } });
  await prisma.venue.deleteMany({ where: { id: { in: [venueId, otherVenueId] } } });
  await prisma.user.delete({ where: { id: userId } });
});

describe('venue report integration', () => {
  it('calculates filtered revenue, booked minutes, and utilisation from confirmed bookings', async () => {
    const confirmed = await createBooking(BookingStatus.CONFIRMED, 1000, slot(1, 1));
    const completed = await createBooking(BookingStatus.COMPLETED, 2000, slot(2, 2));
    await createPayment(confirmed, 1000, PaymentStatus.SUCCEEDED, `ch_${randomUUID()}`);
    await createPayment(completed, 2000, PaymentStatus.SUCCEEDED, `ch_${randomUUID()}`);

    const cancelled = await createBooking(BookingStatus.CANCELLED, 9000, slot(3, 1));
    await createPayment(cancelled, 9000, PaymentStatus.SUCCEEDED, `ch_${randomUUID()}`);
    const failed = await createBooking(BookingStatus.FAILED, 8000, slot(4, 1));
    await createPayment(failed, 8000, PaymentStatus.SUCCEEDED, `ch_${randomUUID()}`);

    const rows = await getVenueReport(prisma, venueId, base, new Date(base.getTime() + 6 * 60 * 60000));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      venueId,
      revenueMinor: 3000,
      confirmedBookings: 2,
      bookedMinutes: 180,
      utilizationPercent: 50,
    });
  });

  it('excludes bookings outside the requested range and other venues', async () => {
    const outside = await createBooking(BookingStatus.CONFIRMED, 7000, slot(10, 1));
    await createPayment(outside, 7000, PaymentStatus.SUCCEEDED, `ch_${randomUUID()}`);
    const otherId = randomUUID();
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO bookings (id, user_id, room_id, slot, protected_slot, status, amount_minor, currency,
        pricing_snapshot, policy_snapshot, created_at, updated_at)
      VALUES (${otherId}::uuid, ${userId}::uuid, ${otherRoomId}::uuid,
        tstzrange(${slot(1, 1).start}, ${slot(1, 1).end}, '[)'), tstzrange(${slot(1, 1).start}, ${slot(1, 1).end}, '[)'),
        'CONFIRMED'::"BookingStatus", 6000, 'PKR', '{}'::jsonb, '{}'::jsonb, now(), now())
    `);
    await createPayment(otherId, 6000, PaymentStatus.SUCCEEDED, `ch_${randomUUID()}`);

    const rows = await getVenueReport(prisma, venueId, base, new Date(base.getTime() + 6 * 60 * 60000));
    expect(rows[0].revenueMinor).toBe(0);
    expect(rows[0].bookedMinutes).toBe(0);
    bookingIds.push(otherId);
  });

  it('keeps audit events append-only without persisting test rows', async () => {
    await expect(prisma.$transaction(async (transaction) => {
      const event = await transaction.auditEvent.create({ data: { type: 'ADMIN_ACTION', reason: 'trigger test' } });
      await transaction.auditEvent.update({ where: { id: event.id }, data: { reason: 'must fail' } });
    })).rejects.toThrow('audit_events are append-only');

    await expect(prisma.$transaction(async (transaction) => {
      const event = await transaction.auditEvent.create({ data: { type: 'ADMIN_ACTION', reason: 'trigger test' } });
      await transaction.auditEvent.delete({ where: { id: event.id } });
    })).rejects.toThrow('audit_events are append-only');
  });
});

describe('reconciliation integration', () => {
  it('classifies valid confirmation and refund outcomes and reports invalid outcomes deterministically', async () => {
    const confirmed = await createBooking(BookingStatus.CONFIRMED, 1000, slot(12, 1));
    await createPayment(confirmed, 1000, PaymentStatus.SUCCEEDED, 'ch_reconcile_confirmed');

    const refunded = await createBooking(BookingStatus.REFUNDED, 2000, slot(13, 1));
    await createPayment(refunded, 2000, PaymentStatus.REFUNDED, 'ch_reconcile_refunded');
    const refundedPayment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: refunded } });
    await prisma.refund.create({ data: { bookingId: refunded, paymentId: refundedPayment.id, idempotencyKey: randomUUID(), providerRefundId: 'rf_reconcile_valid', amountMinor: 2000, currency: 'PKR', status: PaymentStatus.SUCCEEDED } });

    const multiple = await createBooking(BookingStatus.REFUNDED, 3000, slot(14, 1));
    await createPayment(multiple, 3000, PaymentStatus.REFUNDED, 'ch_reconcile_multiple');
    const multiplePayment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: multiple } });
    await prisma.refund.createMany({ data: [
      { bookingId: multiple, paymentId: multiplePayment.id, idempotencyKey: randomUUID(), providerRefundId: 'rf_reconcile_one', amountMinor: 3000, currency: 'PKR', status: PaymentStatus.SUCCEEDED },
      { bookingId: multiple, paymentId: multiplePayment.id, idempotencyKey: randomUUID(), providerRefundId: 'rf_reconcile_two', amountMinor: 3000, currency: 'PKR', status: PaymentStatus.SUCCEEDED },
    ] });

    const both = await createBooking(BookingStatus.CONFIRMED, 4000, slot(15, 1));
    await createPayment(both, 4000, PaymentStatus.SUCCEEDED, 'ch_reconcile_both');
    const bothPayment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: both } });
    await prisma.refund.create({ data: { bookingId: both, paymentId: bothPayment.id, idempotencyKey: randomUUID(), providerRefundId: 'rf_reconcile_both', amountMinor: 4000, currency: 'PKR', status: PaymentStatus.SUCCEEDED } });

    const partial = await createBooking(BookingStatus.REFUNDED, 5000, slot(16, 1));
    await createPayment(partial, 5000, PaymentStatus.REFUNDED, 'ch_reconcile_partial');
    const partialPayment = await prisma.payment.findUniqueOrThrow({ where: { bookingId: partial } });
    await prisma.refund.create({ data: { bookingId: partial, paymentId: partialPayment.id, idempotencyKey: randomUUID(), providerRefundId: 'rf_reconcile_partial', amountMinor: 4999, currency: 'PKR', status: PaymentStatus.SUCCEEDED } });

    chargeIds.push('ch_reconcile_unknown');
    await prisma.paygateCharge.create({ data: { chargeId: 'ch_reconcile_unknown', idempotencyKey: randomUUID(), reference: randomUUID(), amountMinor: 6000, currency: 'PKR', status: 'SUCCEEDED' } });

    const result = await getReconciliation(prisma);
    expect(result.capturedCharges).toBe(6);
    expect(result.reconciledCharges).toBe(2);
    expect(result.discrepancies.map((row) => row.chargeId)).toEqual([
      'ch_reconcile_both',
      'ch_reconcile_multiple',
      'ch_reconcile_partial',
      'ch_reconcile_unknown',
    ]);
  });
});
