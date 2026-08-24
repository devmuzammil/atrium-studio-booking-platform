import { Prisma, PrismaClient, WebhookJobStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { localPaymentProvider, PaymentProvider, processPersistedPaymentEvent } from './paymentService';

const leaseMs = 30000;
const maxAttempts = 8;
const maxBackoffMs = 5 * 60 * 1000;

export interface WebhookPayload {
  deliveryId: string;
  chargeId: string;
  reference: string;
  event: string;
  amountMinor: number;
  currency?: string;
  occurredAt?: Date;
  correlationId?: string;
}

export async function enqueueWebhook(database: PrismaClient, input: WebhookPayload): Promise<{ eventId: string; jobId: string; duplicate: boolean }> {
  const existingEvent = await database.paymentEvent.findUnique({
    where: { providerDeliveryId: input.deliveryId },
    select: { id: true },
  });
  return database.$transaction(async (transaction) => {
    const event = await transaction.paymentEvent.upsert({
      where: { providerDeliveryId: input.deliveryId },
      update: {},
      create: {
        providerDeliveryId: input.deliveryId,
        providerChargeId: input.chargeId,
        event: input.event === 'charge.succeeded' ? 'CHARGE_SUCCEEDED' : input.event === 'charge.failed' ? 'CHARGE_FAILED' : 'UNKNOWN',
        payload: JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue,
        signatureValid: true,
        occurredAt: input.occurredAt,
        correlationId: input.correlationId,
      },
    });
    const job = await transaction.webhookJob.upsert({
      where: { paymentEventId: event.id },
      update: {},
      create: { paymentEventId: event.id },
    });
    return { eventId: event.id, jobId: job.id, duplicate: Boolean(existingEvent) };
  });
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * (2 ** Math.max(0, attempt - 1)), maxBackoffMs);
}

async function recoverExpiredLeases(database: PrismaClient): Promise<void> {
  await database.webhookJob.updateMany({
    where: { status: WebhookJobStatus.PROCESSING, lockedAt: { lt: new Date(Date.now() - leaseMs) } },
    data: { status: WebhookJobStatus.RETRY, lockedAt: null, lockedBy: null, nextAttemptAt: new Date() },
  });
}

async function claimJob(database: PrismaClient, workerId: string): Promise<string | null> {
  const rows = await database.$transaction(async (transaction) => {
    const claimed = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM webhook_jobs
      WHERE ((status IN ('PENDING', 'RETRY') AND next_attempt_at <= now())
        OR (status = 'PROCESSING' AND locked_at < now() - interval '30 seconds'))
      ORDER BY next_attempt_at, created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    if (claimed.length === 0) return [];
    await transaction.webhookJob.update({
      where: { id: claimed[0].id },
      data: { status: WebhookJobStatus.PROCESSING, attemptCount: { increment: 1 }, lockedAt: new Date(), lockedBy: workerId },
    });
    return claimed;
  });
  return rows[0]?.id ?? null;
}

export async function processWebhookJobs(database: PrismaClient, provider: PaymentProvider = localPaymentProvider(database), limit = 10): Promise<number> {
  await recoverExpiredLeases(database);
  let completed = 0;
  for (let index = 0; index < limit; index += 1) {
    const workerId = randomUUID();
    const jobId = await claimJob(database, workerId);
    if (!jobId) break;
    const job = await database.webhookJob.findUnique({ where: { id: jobId }, include: { paymentEvent: true } });
    if (!job) continue;
    const payload = job.paymentEvent.payload as unknown as { deliveryId: string; chargeId: string; reference: string; event: string; amountMinor: number; currency?: string; occurredAt?: string; correlationId?: string };
    try {
      const result = await processPersistedPaymentEvent(database, job.paymentEventId, {
        deliveryId: payload.deliveryId,
        chargeId: payload.chargeId,
        reference: payload.reference,
        event: payload.event,
        amountMinor: payload.amountMinor,
        currency: payload.currency,
        occurredAt: payload.occurredAt ? new Date(payload.occurredAt) : undefined,
        correlationId: payload.correlationId,
      }, provider);
      if (result.status === 'recorded_unknown') throw new Error('Referenced Paygate charge is not available yet');
      await database.webhookJob.update({ where: { id: jobId }, data: { status: WebhookJobStatus.SUCCEEDED, lockedAt: null, lockedBy: null, processedAt: new Date(), lastError: null } });
      completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const current = await database.webhookJob.findUniqueOrThrow({ where: { id: jobId }, select: { attemptCount: true } });
      const dead = current.attemptCount >= maxAttempts;
      await database.webhookJob.update({ where: { id: jobId }, data: { status: dead ? WebhookJobStatus.DEAD_LETTER : WebhookJobStatus.RETRY, nextAttemptAt: new Date(Date.now() + backoffMs(current.attemptCount)), lockedAt: null, lockedBy: null, lastError: message } });
    }
  }
  return completed;
}