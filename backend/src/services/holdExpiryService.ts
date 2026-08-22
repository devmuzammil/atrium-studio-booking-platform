import { BookingStatus, Prisma, PrismaClient } from '@prisma/client';

export interface ExpiryResult {
  bookingId: string;
  expired: boolean;
}

async function expireClaimedHold(
  transaction: Prisma.TransactionClient,
  bookingId: string,
  now: Date,
): Promise<ExpiryResult> {
  const updated = await transaction.$executeRaw(Prisma.sql`
    UPDATE bookings
    SET status = 'EXPIRED'::"BookingStatus",
        updated_at = NOW()
    WHERE id = ${bookingId}::uuid
      AND status = 'HELD'::"BookingStatus"
      AND hold_expires_at IS NOT NULL
      AND hold_expires_at <= ${now}
  `);

  if (updated === 0) {
    return { bookingId, expired: false };
  }

  await transaction.auditEvent.create({
    data: {
      bookingId,
      type: 'BOOKING_STATE_TRANSITION',
      fromStatus: BookingStatus.HELD,
      toStatus: BookingStatus.EXPIRED,
      reason: 'hold TTL elapsed',
    },
  });

  return { bookingId, expired: true };
}

export async function expireDueHolds(
  database: PrismaClient,
  now = new Date(),
  batchSize = 100,
): Promise<ExpiryResult[]> {
  const results: ExpiryResult[] = [];

  for (let index = 0; index < batchSize; index += 1) {
    const result = await database.$transaction(
      async (transaction) => {
        const claimed = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id
          FROM bookings
          WHERE status = 'HELD'::"BookingStatus"
            AND hold_expires_at IS NOT NULL
            AND hold_expires_at <= ${now}
          ORDER BY hold_expires_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        `);

        if (claimed.length === 0) {
          return null;
        }

        return expireClaimedHold(transaction, claimed[0].id, now);
      },
      { timeout: 60000, maxWait: 60000 },
    );

    if (!result) {
      break;
    }

    if (result.expired) {
      results.push(result);
    }
  }

  return results;
}

export async function expireHold(
  database: PrismaClient,
  bookingId: string,
  now = new Date(),
): Promise<ExpiryResult> {
  return database.$transaction(
    async (transaction) => expireClaimedHold(transaction, bookingId, now),
    { timeout: 60000, maxWait: 60000 },
  );
}
