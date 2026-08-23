import { BookingStatus, Prisma, PrismaClient } from '@prisma/client';
import { transitionBookingInTransaction } from './bookingStateMachine';

export interface ExpiryResult {
  bookingId: string;
  expired: boolean;
}

const EXPIRABLE: BookingStatus[] = [BookingStatus.HELD, BookingStatus.PENDING_PAYMENT];

async function expireClaimedHold(
  transaction: Prisma.TransactionClient,
  bookingId: string,
  now: Date,
): Promise<ExpiryResult> {
  const locked = await transaction.$queryRaw<Array<{ id: string; status: BookingStatus; holdExpiresAt: Date | null }>>(Prisma.sql`
    SELECT id, status, hold_expires_at AS "holdExpiresAt"
    FROM bookings
    WHERE id = ${bookingId}::uuid
    FOR UPDATE
  `);

  const booking = locked[0];
  if (
    !booking
    || !EXPIRABLE.includes(booking.status)
    || !booking.holdExpiresAt
    || booking.holdExpiresAt > now
  ) {
    return { bookingId, expired: false };
  }

  await transitionBookingInTransaction(transaction, {
    bookingId,
    to: BookingStatus.EXPIRED,
    reason: booking.status === BookingStatus.PENDING_PAYMENT
      ? 'hold TTL elapsed while payment in flight'
      : 'hold TTL elapsed',
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
          WHERE status IN ('HELD'::"BookingStatus", 'PENDING_PAYMENT'::"BookingStatus")
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
