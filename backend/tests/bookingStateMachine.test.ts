import { BookingStatus } from '@prisma/client';
import {
  canTransition,
  InvalidBookingTransitionError,
  TransitionReasonRequiredError,
  transitionBooking,
  validBookingTransitions,
} from '../src/services/bookingStateMachine';

describe('booking state machine', () => {
  const validTransitions: Array<[BookingStatus, BookingStatus]> = [
    [BookingStatus.DRAFT, BookingStatus.HELD],
    [BookingStatus.HELD, BookingStatus.PENDING_PAYMENT],
    [BookingStatus.HELD, BookingStatus.EXPIRED],
    [BookingStatus.HELD, BookingStatus.CANCELLED],
    [BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED],
    [BookingStatus.PENDING_PAYMENT, BookingStatus.FAILED],
    [BookingStatus.PENDING_PAYMENT, BookingStatus.EXPIRED],
    [BookingStatus.PENDING_PAYMENT, BookingStatus.CANCELLED],
    [BookingStatus.CONFIRMED, BookingStatus.COMPLETED],
    [BookingStatus.CONFIRMED, BookingStatus.CANCELLED],
    [BookingStatus.CANCELLED, BookingStatus.REFUNDED],
    [BookingStatus.EXPIRED, BookingStatus.REFUNDED],
  ];

  it.each(validTransitions)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  const invalidTransitions: Array<[BookingStatus, BookingStatus]> = [
    [BookingStatus.DRAFT, BookingStatus.CONFIRMED],
    [BookingStatus.DRAFT, BookingStatus.CANCELLED],
    [BookingStatus.HELD, BookingStatus.CONFIRMED],
    [BookingStatus.HELD, BookingStatus.COMPLETED],
    [BookingStatus.PENDING_PAYMENT, BookingStatus.HELD],
    [BookingStatus.CONFIRMED, BookingStatus.HELD],
    [BookingStatus.CONFIRMED, BookingStatus.EXPIRED],
    [BookingStatus.CONFIRMED, BookingStatus.REFUNDED],
    [BookingStatus.CANCELLED, BookingStatus.CONFIRMED],
    [BookingStatus.COMPLETED, BookingStatus.DRAFT],
    [BookingStatus.REFUNDED, BookingStatus.DRAFT],
    [BookingStatus.FAILED, BookingStatus.DRAFT],
  ];

  it.each(invalidTransitions)('rejects %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('defines terminal states with no outgoing transitions', () => {
    expect(validBookingTransitions[BookingStatus.COMPLETED]).toEqual([]);
    expect(validBookingTransitions[BookingStatus.REFUNDED]).toEqual([]);
    expect(validBookingTransitions[BookingStatus.FAILED]).toEqual([]);
  });

  it('provides a conflict error for an illegal transition', () => {
    const error = new InvalidBookingTransitionError(BookingStatus.DRAFT, BookingStatus.CONFIRMED);

    expect(error).toBeInstanceOf(Error);
    expect(error.statusCode).toBe(409);
    expect(error.from).toBe(BookingStatus.DRAFT);
    expect(error.to).toBe(BookingStatus.CONFIRMED);
  });

  it('requires a non-empty transition reason', () => {
    const error = new TransitionReasonRequiredError();

    expect(error.statusCode).toBe(400);
    expect(error.message).toContain('reason');
  });

  it('updates the booking and creates one audit event in one transaction', async () => {
    const update = jest.fn().mockResolvedValue({ status: BookingStatus.HELD });
    const createAuditEvent = jest.fn().mockResolvedValue({});
    const transaction = {
      booking: {
        findUnique: jest.fn().mockResolvedValue({ status: BookingStatus.DRAFT }),
        update,
      },
      auditEvent: { create: createAuditEvent },
    };
    const database = {
      $transaction: async (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction),
    } as never;

    await expect(transitionBooking(database, {
      bookingId: 'booking-id',
      to: BookingStatus.HELD,
      actorId: 'actor-id',
      reason: 'hold created',
    })).resolves.toEqual({ status: BookingStatus.HELD });

    expect(update).toHaveBeenCalledTimes(1);
    expect(createAuditEvent).toHaveBeenCalledTimes(1);
    expect(createAuditEvent).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingId: 'booking-id',
        actorId: 'actor-id',
        fromStatus: BookingStatus.DRAFT,
        toStatus: BookingStatus.HELD,
        reason: 'hold created',
      }),
    });
  });

  it('does not update or audit an illegal transition', async () => {
    const update = jest.fn();
    const createAuditEvent = jest.fn();
    const transaction = {
      booking: {
        findUnique: jest.fn().mockResolvedValue({ status: BookingStatus.DRAFT }),
        update,
      },
      auditEvent: { create: createAuditEvent },
    };
    const database = {
      $transaction: async (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction),
    } as never;

    await expect(transitionBooking(database, {
      bookingId: 'booking-id',
      to: BookingStatus.CONFIRMED,
      reason: 'invalid',
    })).rejects.toBeInstanceOf(InvalidBookingTransitionError);

    expect(update).not.toHaveBeenCalled();
    expect(createAuditEvent).not.toHaveBeenCalled();
  });
});