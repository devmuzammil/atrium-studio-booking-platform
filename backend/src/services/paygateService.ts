import { PaygateChargeStatus, PaygateRefundStatus, Prisma, PrismaClient } from '@prisma/client';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';

export interface PaygateChargeInput {
  idempotencyKey: string;
  amountMinor: number;
  currency: string;
  reference: string;
}

export interface PaygateRefundInput {
  idempotencyKey: string;
  chargeId: string;
  amountMinor: number;
  currency?: string;
}

function chaosEnabled(): boolean {
  return process.env.PAYGATE_CHAOS === 'on';
}

function chance(percent: number): boolean {
  return chaosEnabled() && Math.random() < percent / 100;
}

function paygateSecret(): string {
  return process.env.PAYGATE_SECRET || 'development-paygate-secret';
}

export function signPaygateBody(body: string): string {
  return createHmac('sha256', paygateSecret()).update(body).digest('hex');
}

export function verifyPaygateSignature(body: Buffer, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = Buffer.from(createHmac('sha256', paygateSecret()).update(body).digest('hex'));
  const provided = Buffer.from(signature);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

async function deliverWebhook(database: PrismaClient, chargeId: string, reference: string, amountMinor: number, currency: string): Promise<void> {
  const callbackBaseUrl = process.env.PAYGATE_CALLBACK_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}/api/paygate/webhook` : `http://127.0.0.1:${process.env.PORT || 3000}/api/paygate/webhook`);
  const callbackUrl = callbackBaseUrl;
  const body = JSON.stringify({
    charge_id: chargeId,
    reference,
    event: 'charge.succeeded',
    amount_minor: amountMinor,
    currency,
    occurred_at: new Date().toISOString(),
  });
  const invalid = chance(2);
  const send = async (): Promise<void> => {
    try {
      await markChargeSucceeded(database, chargeId);
      await fetch(callbackUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-paygate-signature': invalid ? 'invalid-signature' : signPaygateBody(body),
          'x-paygate-delivery': randomUUID(),
        },
        body,
      });
    } catch (error) {
      console.error('Paygate webhook delivery failed:', error);
    }
  };

  if (chance(5)) {
    if (process.env.VERCEL) {
      await send();
    } else {
      setTimeout(() => void send(), 60000 + Math.floor(Math.random() * 30000));
    }
  } else {
    await send();
  }
  if (chance(30)) await send();
}

export async function createCharge(database: PrismaClient, input: PaygateChargeInput) {
  if (chance(10)) throw new Error('Paygate transient failure');

  const existing = await database.paygateCharge.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return existing;

  try {
    const charge = await database.paygateCharge.create({
      data: {
        chargeId: `ch_${randomUUID().replace(/-/g, '')}`,
        idempotencyKey: input.idempotencyKey,
        reference: input.reference,
        amountMinor: input.amountMinor,
        currency: input.currency,
      },
    });
    await database.paygateCharge.update({ where: { chargeId: charge.chargeId }, data: { status: PaygateChargeStatus.SUCCEEDED } });
    if (!process.env.VERCEL) {
      void deliverWebhook(database, charge.chargeId, input.reference, input.amountMinor, input.currency);
    }
    return charge;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const retry = await database.paygateCharge.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (retry) return retry;
    }
    throw error;
  }
}

export async function createRefund(database: PrismaClient, input: PaygateRefundInput) {
  const existing = await database.paygateRefund.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return existing;

  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) throw Object.assign(new Error('Refund amount must be positive'), { statusCode: 400 });

  try {
    return await database.$transaction(async (transaction) => {
      await transaction.$queryRaw(Prisma.sql`SELECT charge_id FROM paygate_charges WHERE charge_id = ${input.chargeId} FOR UPDATE`);
      const charge = await transaction.paygateCharge.findUnique({ where: { chargeId: input.chargeId } });
      if (!charge) throw Object.assign(new Error('Paygate charge not found'), { statusCode: 400 });
      if (charge.status !== PaygateChargeStatus.SUCCEEDED) throw Object.assign(new Error('Paygate charge is not captured'), { statusCode: 400 });
      if (input.currency && input.currency !== charge.currency) throw Object.assign(new Error('Refund currency does not match charge'), { statusCode: 400 });
      const refunded = await transaction.paygateRefund.aggregate({
        where: { chargeId: input.chargeId, status: PaygateRefundStatus.SUCCEEDED },
        _sum: { amountMinor: true },
      });
      if ((refunded._sum.amountMinor ?? 0) + input.amountMinor > charge.amountMinor) {
        throw Object.assign(new Error('Refund exceeds captured amount'), { statusCode: 400 });
      }
      return transaction.paygateRefund.create({
        data: {
          refundId: `re_${randomUUID().replace(/-/g, '')}`,
          idempotencyKey: input.idempotencyKey,
          chargeId: input.chargeId,
          amountMinor: input.amountMinor,
          status: PaygateRefundStatus.SUCCEEDED,
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const retry = await database.paygateRefund.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (retry) return retry;
    }
    throw error;
  }
}

export async function markChargeSucceeded(database: PrismaClient, chargeId: string) {
  return database.paygateCharge.update({ where: { chargeId }, data: { status: PaygateChargeStatus.SUCCEEDED } });
}
