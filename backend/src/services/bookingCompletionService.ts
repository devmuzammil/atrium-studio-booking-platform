import { BookingStatus, Prisma, PrismaClient } from '@prisma/client';
import { transitionBookingInTransaction } from './bookingStateMachine';

export async function completeDueBookings(
  database: PrismaClient,
  now = new Date(),
  batchSize = 100,
): Promise<string[]> {
  const completed: string[] = [];

  for (let index = 0; index < batchSize; index += 1) {
    const bookingId = await database.$transaction(async (transaction) => {
      const claimed = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id
        FROM bookings
        WHERE status = 'CONFIRMED'::"BookingStatus"
          AND upper(slot) <= ${now}
        ORDER BY upper(slot), id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `);
      if (claimed.length === 0) {
        return null;
      }
      await transitionBookingInTransaction(transaction, {
        bookingId: claimed[0].id,
        to: BookingStatus.COMPLETED,
        reason: 'booking end time has passed',
      });
      return claimed[0].id;
    }, { timeout: 60000, maxWait: 60000 });

    if (!bookingId) {
      break;
    }
    completed.push(bookingId);
  }

  return completed;
}
