import { BookingStatus, PaymentStatus, Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { transitionBookingInTransaction } from './bookingStateMachine';

export interface PaymentProvider {
  charge(input: { idempotencyKey: string; amountMinor: number; currency: string; reference: string }): Promise<{ chargeId: string }>;
  refund(input: { idempotencyKey: string; chargeId: string; amountMinor: number }): Promise<{ refundId: string }>;
}

export class PaymentValidationError extends Error { readonly statusCode = 400; }
export class PaymentConflictError extends Error { readonly statusCode = 409; }

export async function startPayment(database: PrismaClient, provider: PaymentProvider, userId: string, bookingId: string, idempotencyKey: string) {
  if (!idempotencyKey.trim()) throw new PaymentValidationError('Idempotency-Key is required');

  const payment = await database.$transaction(async (transaction) => {
    const booking = await transaction.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, userId: true, status: true, amountMinor: true, currency: true, holdExpiresAt: true },
    });
    if (!booking || booking.userId !== userId) throw new PaymentConflictError('Booking is not accessible');

    const existing = await transaction.payment.findUnique({ where: { bookingId } });
    if (existing) {
      if (existing.idempotencyKey !== idempotencyKey) throw new PaymentConflictError('Booking already has a payment attempt');
      return existing;
    }

    if (booking.status !== BookingStatus.HELD) throw new PaymentConflictError('Booking is not available for payment');
    if (!booking.holdExpiresAt || booking.holdExpiresAt <= new Date()) throw new PaymentConflictError('Booking hold has expired');

    await transitionBookingInTransaction(transaction, {
      bookingId,
      to: BookingStatus.PENDING_PAYMENT,
      actorId: userId,
      reason: 'payment submitted',
    });
    return transaction.payment.create({
      data: { bookingId, idempotencyKey, amountMinor: booking.amountMinor, currency: booking.currency, status: PaymentStatus.PROCESSING },
    });
  });

  if (payment.providerChargeId) return payment;

  try {
    const charge = await provider.charge({
      idempotencyKey: payment.idempotencyKey,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      reference: bookingId,
    });
    return database.payment.update({ where: { id: payment.id }, data: { providerChargeId: charge.chargeId } });
  } catch (error) {
    throw error;
  }
}

async function processPaymentWebhookOnce(
  database: PrismaClient,
  input: { deliveryId: string; chargeId: string; reference: string; event: string; amountMinor: number; currency?: string; occurredAt?: Date },
  provider: PaymentProvider,
): Promise<{ status: string }> {
  const result = await database.$transaction(async (transaction) => {
    try {
      await transaction.paymentEvent.create({
        data: {
          providerDeliveryId: input.deliveryId,
          providerChargeId: input.chargeId,
          event: input.event === 'charge.succeeded' ? 'CHARGE_SUCCEEDED' : input.event === 'charge.failed' ? 'CHARGE_FAILED' : 'UNKNOWN',
          payload: JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue,
          signatureValid: true,
          occurredAt: input.occurredAt,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { status: 'duplicate' };
      throw error;
    }

    const paymentLock = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM payments WHERE provider_charge_id = ${input.chargeId} FOR UPDATE
    `);
    const payment = paymentLock.length > 0
      ? await transaction.payment.findUnique({ where: { id: paymentLock[0].id } })
      : null;
    if (!payment) return { status: 'recorded_unknown' };
    if (payment.amountMinor !== input.amountMinor || (input.currency && payment.currency !== input.currency) || payment.bookingId !== input.reference) return { status: 'payment_mismatch' };
    await transaction.$queryRaw(Prisma.sql`SELECT id FROM bookings WHERE id = ${payment.bookingId}::uuid FOR UPDATE`);
    const booking = await transaction.booking.findUnique({ where: { id: payment.bookingId }, select: { id: true, status: true, holdExpiresAt: true, amountMinor: true, currency: true } });
    if (!booking) return { status: 'recorded_unknown' };

    if (input.event === 'charge.succeeded' && payment.status === PaymentStatus.PROCESSING) {
      await transaction.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.SUCCEEDED } });
      if (booking.status === BookingStatus.PENDING_PAYMENT && booking.holdExpiresAt && booking.holdExpiresAt > new Date()) {
        await transitionBookingInTransaction(transaction, { bookingId: booking.id, to: BookingStatus.CONFIRMED, reason: 'payment succeeded' });
        return { status: 'confirmed' };
      }
      if (booking.status === BookingStatus.EXPIRED || !booking.holdExpiresAt || booking.holdExpiresAt <= new Date()) {
        await transaction.refund.create({ data: { bookingId: booking.id, paymentId: payment.id, idempotencyKey: `refund:${payment.id}`, amountMinor: payment.amountMinor, currency: payment.currency, status: PaymentStatus.PROCESSING } });
        if (booking.status === BookingStatus.PENDING_PAYMENT) {
          await transitionBookingInTransaction(transaction, { bookingId: booking.id, to: BookingStatus.EXPIRED, reason: 'payment completed after hold expiry' });
        }
        await transitionBookingInTransaction(transaction, { bookingId: booking.id, to: BookingStatus.REFUNDED, reason: 'payment succeeded after hold expiry' });
        return { status: 'refund_required', refundChargeId: input.chargeId, refundAmountMinor: payment.amountMinor, refundKey: `refund:${payment.id}` };
      }
    } else if (input.event === 'charge.failed' && payment.status === PaymentStatus.PROCESSING) {
      await transaction.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.FAILED } });
      if (booking.status === BookingStatus.PENDING_PAYMENT) await transitionBookingInTransaction(transaction, { bookingId: booking.id, to: BookingStatus.FAILED, reason: 'payment failed' });
      return { status: 'failed' };
    }
    return { status: 'ignored' };
  }, { timeout: 30000 }).catch((error) => { throw error; });

  if (result.status === 'refund_required' && result.refundKey && result.refundChargeId && result.refundAmountMinor !== undefined) {
    await provider.refund({ idempotencyKey: result.refundKey, chargeId: result.refundChargeId, amountMinor: result.refundAmountMinor });
  }
  return { status: result.status };
}

function isRetryableWebhookTransactionError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && ['P2028', 'P2034'].includes(error.code);
}

export async function processPaymentWebhook(
  database: PrismaClient,
  input: { deliveryId: string; chargeId: string; reference: string; event: string; amountMinor: number; currency?: string; occurredAt?: Date },
  provider: PaymentProvider,
): Promise<{ status: string }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await processPaymentWebhookOnce(database, input, provider);
    } catch (error) {
      if (!isRetryableWebhookTransactionError(error) || attempt === 2) throw error;
    }
  }

  throw new Error('Webhook processing retry limit reached');
}

export function localPaymentProvider(database: PrismaClient): PaymentProvider {
  return {
    charge: async (input) => {
      const baseUrl = process.env.PAYGATE_URL || `http://localhost:${process.env.PORT || 3000}`;
      const response = await fetch(`${baseUrl}/paygate/charges`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': input.idempotencyKey }, body: JSON.stringify({ amount_minor: input.amountMinor, currency: input.currency, reference: input.reference }) });
      if (!response.ok) throw new Error('Paygate charge request failed');
      const body = await response.json() as { charge_id: string };
      return { chargeId: body.charge_id };
    },
    refund: async (input) => {
      const baseUrl = process.env.PAYGATE_URL || `http://localhost:${process.env.PORT || 3000}`;
      const response = await fetch(`${baseUrl}/paygate/refunds`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': input.idempotencyKey }, body: JSON.stringify({ charge_id: input.chargeId, amount_minor: input.amountMinor }) });
      if (!response.ok) throw new Error('Paygate refund request failed');
      const body = await response.json() as { refund_id: string };
      return { refundId: body.refund_id };
    },
  };
}

export function webhookDeliveryId(): string { return randomUUID(); }
