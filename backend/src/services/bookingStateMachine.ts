import { BookingStatus, Prisma, PrismaClient } from '@prisma/client';

export const validBookingTransitions: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = {
  [BookingStatus.DRAFT]: [BookingStatus.HELD],
  [BookingStatus.HELD]: [BookingStatus.PENDING_PAYMENT, BookingStatus.EXPIRED, BookingStatus.CANCELLED],
  [BookingStatus.PENDING_PAYMENT]: [BookingStatus.CONFIRMED, BookingStatus.FAILED, BookingStatus.EXPIRED, BookingStatus.CANCELLED],
  [BookingStatus.CONFIRMED]: [BookingStatus.COMPLETED, BookingStatus.CANCELLED],
  [BookingStatus.COMPLETED]: [],
  [BookingStatus.EXPIRED]: [BookingStatus.REFUNDED],
  [BookingStatus.FAILED]: [BookingStatus.REFUNDED],
  [BookingStatus.CANCELLED]: [BookingStatus.REFUNDED],
  [BookingStatus.REFUNDED]: [],
};

export class InvalidBookingTransitionError extends Error {
  readonly statusCode = 409;
  readonly from: BookingStatus;
  readonly to: BookingStatus;

  constructor(from: BookingStatus, to: BookingStatus) {
    super(`Invalid booking transition: ${from} -> ${to}`);
    this.name = 'InvalidBookingTransitionError';
    this.from = from;
    this.to = to;
  }
}

export class TransitionReasonRequiredError extends Error {
  readonly statusCode = 400;

  constructor() {
    super('A transition reason is required');
    this.name = 'TransitionReasonRequiredError';
  }
}

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return validBookingTransitions[from].includes(to);
}

export interface TransitionBookingInput {
  bookingId: string;
  to: BookingStatus;
  actorId?: string;
  reason: string;
}

export type BookingTransactionClient = Prisma.TransactionClient;

export async function transitionBookingInTransaction(
  transaction: BookingTransactionClient,
  input: TransitionBookingInput,
): Promise<{ status: BookingStatus }> {
  if (!input.reason.trim()) {
    throw new TransitionReasonRequiredError();
  }

  const booking = await transaction.booking.findUnique({
    where: { id: input.bookingId },
    select: { status: true },
  });

  if (!booking) {
    throw new Error('Booking not found');
  }

  if (!canTransition(booking.status, input.to)) {
    throw new InvalidBookingTransitionError(booking.status, input.to);
  }

  const updatedBooking = await transaction.booking.update({
    where: { id: input.bookingId },
    data: { status: input.to },
    select: { status: true },
  });

  await transaction.auditEvent.create({
    data: {
      bookingId: input.bookingId,
      actorId: input.actorId,
      type: 'BOOKING_STATE_TRANSITION',
      fromStatus: booking.status,
      toStatus: input.to,
      reason: input.reason,
    },
  });

  return updatedBooking;
}

export async function transitionBooking(
  prisma: PrismaClient,
  input: TransitionBookingInput,
): Promise<{ status: BookingStatus }> {
  return prisma.$transaction((transaction) => transitionBookingInTransaction(transaction, input));
}