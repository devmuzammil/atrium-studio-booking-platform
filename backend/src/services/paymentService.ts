import { BookingStatus, PaymentStatus, Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { transitionBookingInTransaction } from './bookingStateMachine';
import { createCharge, createRefund, signPaygateBody } from './paygateService';

export interface PaymentProvider {
  charge(input: { idempotencyKey: string; amountMinor: number; currency: string; reference: string }): Promise<{ chargeId: string }>;
  refund(input: { idempotencyKey: string; chargeId: string; amountMinor: number }): Promise<{ refundId: string }>;
}

export class PaymentValidationError extends Error { readonly statusCode = 400; }
export class PaymentConflictError extends Error { readonly statusCode = 409; }

export async function startPayment(database: PrismaClient, provider: PaymentProvider, actorId: string, bookingId: string, idempotencyKey: string) {
  if (!idempotencyKey.trim()) throw new PaymentValidationError('Idempotency-Key is required');

  const payment = await database.$transaction(async (transaction) => {
    const booking = await transaction.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, userId: true, status: true, amountMinor: true, currency: true, holdExpiresAt: true },
    });
    if (!booking || booking.userId !== actorId) throw new PaymentConflictError('Booking is not accessible');

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
      actorId,
      reason: 'payment submitted',
    });
    return transaction.payment.create({
      data: { bookingId, idempotencyKey, amountMinor: booking.amountMinor, currency: booking.currency, status: PaymentStatus.PROCESSING },
    });
  });

  if (payment.providerChargeId) return payment;

  let charge: { chargeId: string } | undefined;
  for (let attempt = 0; attempt < 3 && !charge; attempt += 1) {
    try {
      charge = await provider.charge({
        idempotencyKey: payment.idempotencyKey,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        reference: bookingId,
      });
    } catch (error) {
      if (attempt === 2) {
        console.error('Paygate charge remains retryable:', error);
      }
    }
  }
  if (!charge) return payment;

  const updatedPayment = await database.payment.update({ where: { id: payment.id }, data: { providerChargeId: charge.chargeId } });
  if (process.env.VERCEL) {
    await processPaymentWebhook(database, {
      deliveryId: randomUUID(),
      chargeId: charge.chargeId,
      reference: bookingId,
      event: 'charge.succeeded',
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      occurredAt: new Date(),
    }, provider);
  }
  return updatedPayment;
}

async function processPaymentWebhookOnce(
  database: PrismaClient,
  input: { deliveryId: string; chargeId: string; reference: string; event: string; amountMinor: number; currency?: string; occurredAt?: Date; correlationId?: string },
  provider: PaymentProvider,
  eventId?: string,
  persistEvent = true,
): Promise<{ status: string }> {
  const result = await database.$transaction(async (transaction) => {
    const paymentLock = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM payments WHERE provider_charge_id = ${input.chargeId} FOR UPDATE
    `);
    const payment = paymentLock.length > 0
      ? await transaction.payment.findUnique({ where: { id: paymentLock[0].id } })
      : null;
    const latestEvent = await transaction.paymentEvent.findFirst({
      where: { providerChargeId: input.chargeId, ...(eventId ? { id: { not: eventId } } : {}) },
      orderBy: { createdAt: 'desc' },
      select: { event: true, occurredAt: true },
    });
    const staleEvent = latestEvent?.event === 'CHARGE_SUCCEEDED'
      || (latestEvent?.occurredAt && input.occurredAt && input.occurredAt < latestEvent.occurredAt);
    if (persistEvent) {
      try {
        await transaction.paymentEvent.create({
          data: {
            providerDeliveryId: input.deliveryId,
            providerChargeId: input.chargeId,
            event: input.event === 'charge.succeeded' ? 'CHARGE_SUCCEEDED' : input.event === 'charge.failed' ? 'CHARGE_FAILED' : 'UNKNOWN',
            payload: JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue,
            signatureValid: true,
            occurredAt: input.occurredAt,
            correlationId: input.correlationId,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { status: 'duplicate' };
        throw error;
      }
    }
    if (!payment) return { status: 'recorded_unknown' };
    if (payment.amountMinor !== input.amountMinor || (input.currency && payment.currency !== input.currency) || payment.bookingId !== input.reference) return { status: 'payment_mismatch' };
    if (staleEvent) return { status: 'ignored_stale' };
    await transaction.$queryRaw(Prisma.sql`SELECT id FROM bookings WHERE id = ${payment.bookingId}::uuid FOR UPDATE`);
    const booking = await transaction.booking.findUnique({ where: { id: payment.bookingId }, select: { id: true, status: true, holdExpiresAt: true, amountMinor: true, currency: true } });
    if (!booking) return { status: 'recorded_unknown' };

    if (input.event === 'charge.succeeded'
      && (payment.status === PaymentStatus.PROCESSING || payment.status === PaymentStatus.FAILED)) {
      await transaction.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.SUCCEEDED } });
      if (booking.status === BookingStatus.PENDING_PAYMENT && booking.holdExpiresAt && booking.holdExpiresAt > new Date()) {
        await transitionBookingInTransaction(transaction, { bookingId: booking.id, to: BookingStatus.CONFIRMED, reason: 'payment succeeded' });
        return { status: 'confirmed' };
      }
      if (booking.status === BookingStatus.CANCELLED || booking.status === BookingStatus.EXPIRED || booking.status === BookingStatus.FAILED || !booking.holdExpiresAt || booking.holdExpiresAt <= new Date()) {
        await transaction.refund.create({ data: { bookingId: booking.id, paymentId: payment.id, idempotencyKey: `refund:${payment.id}`, amountMinor: payment.amountMinor, currency: payment.currency, status: PaymentStatus.PROCESSING } });
        if (booking.status === BookingStatus.PENDING_PAYMENT) {
          await transitionBookingInTransaction(transaction, { bookingId: booking.id, to: BookingStatus.EXPIRED, reason: 'payment completed after hold expiry' });
        }
        return { status: 'refund_required', refundChargeId: input.chargeId, refundAmountMinor: payment.amountMinor, refundKey: `refund:${payment.id}` };
      }
    } else if (input.event === 'charge.failed' && payment.status === PaymentStatus.PROCESSING) {
      await transaction.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.FAILED } });
      if (booking.status === BookingStatus.PENDING_PAYMENT) await transitionBookingInTransaction(transaction, { bookingId: booking.id, to: BookingStatus.FAILED, reason: 'payment failed' });
      return { status: 'failed' };
    }
    return { status: 'ignored' };
  }, { timeout: 30000 }).catch((error) => { throw error; });

  if (persistEvent && result.status !== 'duplicate') {
    await database.paymentEvent.updateMany({
      where: { providerDeliveryId: input.deliveryId, processedAt: null },
      data: { processedAt: new Date() },
    });
  }

  if (result.status === 'refund_required' && result.refundKey && result.refundChargeId && result.refundAmountMinor !== undefined) {
    try {
      const providerRefund = await provider.refund({ idempotencyKey: result.refundKey, chargeId: result.refundChargeId, amountMinor: result.refundAmountMinor });
      const refund = await database.refund.findUnique({ where: { idempotencyKey: result.refundKey }, select: { id: true, bookingId: true } });
      if (refund) {
        await database.$transaction(async (transaction) => {
          await transaction.refund.update({ where: { id: refund.id }, data: { providerRefundId: providerRefund.refundId, status: PaymentStatus.REFUNDED } });
          const booking = await transaction.booking.findUnique({ where: { id: refund.bookingId }, select: { status: true } });
          if (booking?.status === BookingStatus.EXPIRED || booking?.status === BookingStatus.FAILED) {
            await transitionBookingInTransaction(transaction, { bookingId: refund.bookingId, to: BookingStatus.REFUNDED, reason: 'late payment refund completed' });
          }
        });
      }
    } catch (error) {
      console.error('Payment refund remains recoverable:', error);
    }
  }
  return { status: result.status };
}

function isRetryableWebhookTransactionError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && ['P2028', 'P2034'].includes(error.code);
}

export async function processPaymentWebhook(
  database: PrismaClient,
  input: { deliveryId: string; chargeId: string; reference: string; event: string; amountMinor: number; currency?: string; occurredAt?: Date; correlationId?: string },
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

export async function processPersistedPaymentEvent(
  database: PrismaClient,
  eventId: string,
  input: { deliveryId: string; chargeId: string; reference: string; event: string; amountMinor: number; currency?: string; occurredAt?: Date; correlationId?: string },
  provider: PaymentProvider,
): Promise<{ status: string }> {
  return processPaymentWebhookOnce(database, input, provider, eventId, false);
}

export function localPaymentProvider(database: PrismaClient): PaymentProvider {
  return {
    charge: async (input) => {
      if (process.env.VERCEL) {
        const charge = await createCharge(database, input);
        return { chargeId: charge.chargeId };
      }
      const baseUrl = process.env.PAYGATE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://127.0.0.1:${process.env.PORT || 3000}`);
      const body = JSON.stringify({ amount_minor: input.amountMinor, currency: input.currency, reference: input.reference });
      const response = await fetch(`${baseUrl}/paygate/charges`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': input.idempotencyKey, 'x-paygate-signature': signPaygateBody(body) }, body });
      if (!response.ok) throw new Error('Paygate charge request failed');
      const responseBody = await response.json() as { charge_id: string };
      return { chargeId: responseBody.charge_id };
    },
    refund: async (input) => {
      if (process.env.VERCEL) {
        const refund = await createRefund(database, input);
        return { refundId: refund.refundId };
      }
      const baseUrl = process.env.PAYGATE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
      const body = JSON.stringify({ charge_id: input.chargeId, amount_minor: input.amountMinor });
      const response = await fetch(`${baseUrl}/paygate/refunds`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': input.idempotencyKey, 'x-paygate-signature': signPaygateBody(body) }, body });
      if (!response.ok) throw new Error('Paygate refund request failed');
      const responseBody = await response.json() as { refund_id: string };
      return { refundId: responseBody.refund_id };
    },
  };
}

export function webhookDeliveryId(): string { return randomUUID(); }
