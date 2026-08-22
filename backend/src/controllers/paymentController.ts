import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { authorizeBookingAccess, requireAuthenticatedUser } from '../middleware/authorization';
import { localPaymentProvider, PaymentProvider, processPaymentWebhook, startPayment } from '../services/paymentService';
import { verifyPaygateSignature } from '../services/paygateService';
import type { RawBodyRequest } from '../app';

export async function startBookingPayment(request: Request, response: Response, next: NextFunction, provider?: PaymentProvider): Promise<void> {
  try {
    const authenticated = requireAuthenticatedUser(request);
    const bookingId = request.params.id;
    if (typeof bookingId !== 'string') throw Object.assign(new Error('Booking ID is required'), { statusCode: 400 });
    const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { userId: true, room: { select: { venueId: true } } } });
    if (!booking) { response.status(404).json({ error: 'Booking not found' }); return; }
    authorizeBookingAccess(authenticated, { userId: booking.userId, venueId: booking.room.venueId });
    const idempotencyKey = request.header('Idempotency-Key');
    if (!idempotencyKey) { response.status(400).json({ error: 'Idempotency-Key is required' }); return; }
    const payment = await startPayment(prisma, provider || localPaymentProvider(prisma), authenticated.user?.id as string, bookingId, idempotencyKey);
    response.status(202).json({ payment });
  } catch (error) { next(error); }
}

export async function receivePaygateWebhook(request: Request, response: Response, next: NextFunction, provider?: PaymentProvider): Promise<void> {
  try {
    const rawRequest = request as RawBodyRequest;
    if (!rawRequest.rawBody || !verifyPaygateSignature(rawRequest.rawBody, request.header('x-paygate-signature'))) {
      console.warn('Rejected Paygate webhook with invalid signature');
      response.status(401).json({ error: 'Invalid Paygate signature' });
      return;
    }
    const body = request.body as Record<string, unknown>;
    const deliveryId = request.header('x-paygate-delivery');
    if (!deliveryId || typeof body.charge_id !== 'string' || typeof body.reference !== 'string' || typeof body.event !== 'string' || typeof body.amount_minor !== 'number') {
      response.status(400).json({ error: 'Invalid Paygate webhook payload' });
      return;
    }
    const result = await processPaymentWebhook(prisma, {
      deliveryId,
      chargeId: body.charge_id,
      reference: body.reference,
      event: body.event,
      amountMinor: body.amount_minor,
      currency: typeof body.currency === 'string' ? body.currency : undefined,
      occurredAt: typeof body.occurred_at === 'string' ? new Date(body.occurred_at) : undefined,
    }, provider || localPaymentProvider(prisma));
    response.status(200).json(result);
  } catch (error) { next(error); }
}
