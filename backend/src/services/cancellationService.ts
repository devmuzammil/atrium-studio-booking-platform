import { BookingStatus, PaymentStatus, Prisma, PrismaClient } from '@prisma/client';
import { transitionBookingInTransaction } from './bookingStateMachine';
import { PaymentProvider } from './paymentService';

export interface RefundTerms {
  roomPercent: number;
  equipmentPercent: number;
}

export class CancellationError extends Error { readonly statusCode = 409; }

export const defaultRefundTerms = (hoursUntilStart: number): RefundTerms => {
  if (hoursUntilStart > 48) return { roomPercent: 100, equipmentPercent: 100 };
  if (hoursUntilStart >= 24) return { roomPercent: 50, equipmentPercent: 100 };
  return { roomPercent: 0, equipmentPercent: hoursUntilStart > 2 ? 100 : 0 };
};

function termsFromPolicy(policy: Prisma.JsonValue, hoursUntilStart: number): RefundTerms {
  if (typeof policy !== 'object' || policy === null || Array.isArray(policy)) return defaultRefundTerms(hoursUntilStart);
  const value = policy as Record<string, Prisma.JsonValue>;
  const roomPercent = value.roomPercent;
  const equipmentPercent = value.equipmentPercent;
  if (typeof roomPercent === 'number' && typeof equipmentPercent === 'number') {
    return { roomPercent, equipmentPercent };
  }
  const tier = hoursUntilStart > 48 ? value.moreThan48 : hoursUntilStart >= 24 ? value.between24And48 : value.lessThan24;
  if (typeof tier === 'object' && tier !== null && !Array.isArray(tier)) {
    const selected = tier as Record<string, Prisma.JsonValue>;
    if (typeof selected.roomPercent === 'number' && typeof selected.equipmentPercent === 'number') {
      return { roomPercent: selected.roomPercent, equipmentPercent: selected.equipmentPercent };
    }
  }
  return defaultRefundTerms(hoursUntilStart);
}

export async function cancelBooking(
  database: PrismaClient,
  provider: PaymentProvider,
  bookingId: string,
  actorId: string,
  authorizedVenueId?: string,
): Promise<{ bookingId: string; status: BookingStatus; refundAmountMinor: number }> {
  const result = await database.$transaction(async (transaction) => {
    await transaction.$queryRaw(Prisma.sql`SELECT id FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`);
    const booking = await transaction.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, userId: true, roomId: true, status: true, amountMinor: true, currency: true, pricingSnapshot: true, policySnapshot: true },
    });
    if (!booking) throw new CancellationError('Booking is not accessible');
    const room = await transaction.room.findUnique({ where: { id: booking.roomId }, select: { venueId: true, hourlyRateMinor: true } });
    if (booking.userId !== actorId && room?.venueId !== authorizedVenueId) throw new CancellationError('Booking is not accessible');
    if (!([BookingStatus.HELD, BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED] as BookingStatus[]).includes(booking.status)) {
      throw new CancellationError('This booking can no longer be cancelled');
    }

    const interval = await transaction.$queryRaw<Array<{ start: Date; end: Date }>>(Prisma.sql`SELECT lower(slot) AS start, upper(slot) AS end FROM bookings WHERE id = ${bookingId}::uuid`);
    if (!room || interval.length === 0) throw new CancellationError('Booking inventory could not be loaded');
    const hoursUntilStart = (interval[0].start.getTime() - Date.now()) / 3600000;
    const policy = await transaction.cancellationPolicy.findFirst({ where: { venueId: room.venueId, active: true }, orderBy: { version: 'desc' }, select: { tiers: true } });
    const snapshot = typeof booking.policySnapshot === 'object' && booking.policySnapshot !== null && !Array.isArray(booking.policySnapshot)
      ? booking.policySnapshot as Record<string, Prisma.JsonValue>
      : {};
    const terms = termsFromPolicy(snapshot.tiers ?? policy?.tiers ?? {}, hoursUntilStart);
    const pricing = typeof booking.pricingSnapshot === 'object' && booking.pricingSnapshot !== null && !Array.isArray(booking.pricingSnapshot)
      ? booking.pricingSnapshot as Record<string, Prisma.JsonValue>
      : {};
    const durationHours = (interval[0].end.getTime() - interval[0].start.getTime()) / 3600000;
    const roomAmount = typeof pricing.roomRateMinor === 'number' ? Math.round(pricing.roomRateMinor * durationHours) : Math.round(room.hourlyRateMinor * durationHours);
    const equipmentAmount = Math.max(0, booking.amountMinor - roomAmount);
    const refundAmountMinor = Math.floor(roomAmount * terms.roomPercent / 100) + Math.floor(equipmentAmount * terms.equipmentPercent / 100);
    await transitionBookingInTransaction(transaction, { bookingId, to: BookingStatus.CANCELLED, actorId, reason: 'customer cancellation' });

    const payment = await transaction.payment.findUnique({ where: { bookingId }, select: { id: true, providerChargeId: true, amountMinor: true, status: true } });
    if (!payment || !([PaymentStatus.PROCESSING, PaymentStatus.SUCCEEDED] as PaymentStatus[]).includes(payment.status) || !payment.providerChargeId || refundAmountMinor === 0) {
      return { bookingId, status: BookingStatus.CANCELLED, refundAmountMinor };
    }
    const refundKey = `refund:cancel:${bookingId}:${refundAmountMinor}`;
    const refund = await transaction.refund.upsert({
      where: { idempotencyKey: refundKey },
      create: { bookingId, paymentId: payment.id, idempotencyKey: refundKey, amountMinor: refundAmountMinor, currency: booking.currency, status: PaymentStatus.PROCESSING },
      update: {},
    });
    return { bookingId, status: BookingStatus.CANCELLED, refundAmountMinor, providerChargeId: payment.providerChargeId, refundId: refund.id, refundKey };
  });

  if ('providerChargeId' in result && result.providerChargeId && 'refundKey' in result && result.refundKey && 'refundId' in result && result.refundId && result.refundAmountMinor > 0) {
    try {
      const providerRefund = await provider.refund({ idempotencyKey: result.refundKey, chargeId: result.providerChargeId, amountMinor: result.refundAmountMinor });
      await database.$transaction(async (transaction) => {
        await transaction.refund.update({ where: { id: result.refundId }, data: { providerRefundId: providerRefund.refundId, status: PaymentStatus.REFUNDED } });
        await transitionBookingInTransaction(transaction, { bookingId, to: BookingStatus.REFUNDED, actorId, reason: 'cancellation refund completed' });
      });
      return { ...result, status: BookingStatus.REFUNDED };
    } catch (error) {
      console.error('Cancellation refund remains recoverable:', error);
    }
  }
  return result;
}

export async function retryPendingRefunds(database: PrismaClient, provider: PaymentProvider): Promise<number> {
  const pending = await database.refund.findMany({
    where: { status: PaymentStatus.PROCESSING },
    select: { id: true, bookingId: true, paymentId: true, idempotencyKey: true, amountMinor: true },
    take: 50,
    orderBy: { createdAt: 'asc' },
  });
  let completed = 0;
  for (const refund of pending) {
    const payment = await database.payment.findUnique({ where: { id: refund.paymentId }, select: { providerChargeId: true } });
    if (!payment?.providerChargeId) continue;
    try {
      const providerRefund = await provider.refund({ idempotencyKey: refund.idempotencyKey, chargeId: payment.providerChargeId, amountMinor: refund.amountMinor });
      await database.$transaction(async (transaction) => {
        const updated = await transaction.refund.updateMany({ where: { id: refund.id, status: PaymentStatus.PROCESSING }, data: { providerRefundId: providerRefund.refundId, status: PaymentStatus.REFUNDED } });
        if (updated.count === 0) return;
        await transaction.$queryRaw(Prisma.sql`SELECT id FROM bookings WHERE id = ${refund.bookingId}::uuid FOR UPDATE`);
        const booking = await transaction.booking.findUnique({ where: { id: refund.bookingId }, select: { status: true } });
        if (booking?.status === BookingStatus.CANCELLED || booking?.status === BookingStatus.EXPIRED) {
          await transitionBookingInTransaction(transaction, { bookingId: refund.bookingId, to: BookingStatus.REFUNDED, reason: 'pending refund completed' });
        }
      });
      completed += 1;
    } catch (error) {
      console.error('Pending refund retry failed:', error);
    }
  }
  return completed;
}