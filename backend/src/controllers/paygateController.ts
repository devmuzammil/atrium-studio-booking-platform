import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { createCharge, createRefund, verifyPaygateSignature } from '../services/paygateService';

export function requireInternalPaygateSignature(request: Request, _response: Response, next: NextFunction): void {
  const rawBody = (request as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody || !verifyPaygateSignature(rawBody, request.header('x-paygate-signature'))) {
    next(Object.assign(new Error('Invalid internal Paygate signature'), { statusCode: 401 }));
    return;
  }
  next();
}

function requiredHeader(request: Request, name: string): string {
  const value = request.header(name);
  if (!value) throw Object.assign(new Error(`${name} is required`), { statusCode: 400 });
  return value;
}

function requiredBodyNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw Object.assign(new Error(`${name} must be a positive integer`), { statusCode: 400 });
  }
  return value;
}

export async function postCharge(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const currency = request.body?.currency;
    const reference = request.body?.reference;
    if (typeof currency !== 'string' || !currency || typeof reference !== 'string' || !reference) {
      throw Object.assign(new Error('currency and reference are required'), { statusCode: 400 });
    }
    const charge = await createCharge(prisma, {
      idempotencyKey: requiredHeader(request, 'Idempotency-Key'),
      amountMinor: requiredBodyNumber(request.body?.amount_minor, 'amount_minor'),
      currency,
      reference,
    });
    response.status(202).json({ charge_id: charge.chargeId, status: 'processing' });
  } catch (error) {
    next(error);
  }
}

export async function postRefund(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const refund = await createRefund(prisma, {
      idempotencyKey: requiredHeader(request, 'Idempotency-Key'),
      chargeId: typeof request.body?.charge_id === 'string' ? request.body.charge_id : '',
      amountMinor: requiredBodyNumber(request.body?.amount_minor, 'amount_minor'),
      currency: typeof request.body?.currency === 'string' ? request.body.currency : undefined,
    });
    response.status(202).json({ refund_id: refund.refundId, status: refund.status.toLowerCase() });
  } catch (error) {
    next(error);
  }
}
