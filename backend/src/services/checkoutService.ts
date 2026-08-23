import { BookingStatus, PrismaClient } from '@prisma/client';
import { PaymentConflictError } from './paymentService';

const CHECKOUT_MINUTES = 10;

export async function beginCheckout(
  database: PrismaClient,
  userId: string,
  bookingId: string,
): Promise<{ id: string; status: BookingStatus; holdExpiresAt: Date; checkoutDeadline: Date }> {
  return database.$transaction(async (transaction) => {
    const booking = await transaction.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        userId: true,
        status: true,
        holdExpiresAt: true,
        checkoutDeadline: true,
      },
    });

    if (!booking || booking.userId !== userId) {
      throw new PaymentConflictError('Booking is not accessible');
    }
    if (booking.status !== BookingStatus.HELD) {
      throw new PaymentConflictError('Booking is not available for checkout');
    }
    if (!booking.holdExpiresAt || booking.holdExpiresAt <= new Date()) {
      throw new PaymentConflictError('Booking hold has expired');
    }

    const checkoutDeadline = new Date(Date.now() + CHECKOUT_MINUTES * 60000);
    const holdExpiresAt = booking.holdExpiresAt > checkoutDeadline
      ? booking.holdExpiresAt
      : checkoutDeadline;

    const updated = await transaction.booking.update({
      where: { id: bookingId },
      data: { checkoutDeadline, holdExpiresAt },
      select: {
        id: true,
        status: true,
        holdExpiresAt: true,
        checkoutDeadline: true,
      },
    });

    if (!updated.holdExpiresAt || !updated.checkoutDeadline) {
      throw new PaymentConflictError('Checkout window could not be granted');
    }

    return {
      id: updated.id,
      status: updated.status,
      holdExpiresAt: updated.holdExpiresAt,
      checkoutDeadline: updated.checkoutDeadline,
    };
  });
}
