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
  const callbackUrl = process.env.PAYGATE_CALLBACK_URL || `http://127.0.0.1:${process.env.PORT || 3000}/api/paygate/webhook`;
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
    setTimeout(() => void send(), 60000 + Math.floor(Math.random() * 30000));
  } else {
    void send();
  }
  if (chance(30)) void send();
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
    void deliverWebhook(database, charge.chargeId, input.reference, input.amountMinor, input.currency);
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

  const charge = await database.paygateCharge.findUnique({ where: { chargeId: input.chargeId } });
  if (!charge) throw new Error('Paygate charge not found');

  try {
    return await database.paygateRefund.create({
      data: {
        refundId: `re_${randomUUID().replace(/-/g, '')}`,
        idempotencyKey: input.idempotencyKey,
        chargeId: input.chargeId,
        amountMinor: input.amountMinor,
        status: PaygateRefundStatus.SUCCEEDED,
      },
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
