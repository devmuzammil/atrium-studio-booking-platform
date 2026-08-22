import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { authorizeBookingAccess, authorizeVenueAccess, requireAuthenticatedUser } from '../middleware/authorization';

function getResourceId(request: Request): string {
  const resourceId = request.params.id;
  if (typeof resourceId !== 'string') {
    throw new Error('Resource ID must be a string');
  }

  return resourceId;
}

export async function getBooking(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const authenticatedRequest = requireAuthenticatedUser(request);
    const bookingId = getResourceId(request);
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        userId: true,
        roomId: true,
        status: true,
      },
    });

    if (!booking) {
      response.status(404).json({ error: 'Booking not found' });
      return;
    }

    const room = await prisma.room.findUnique({
      where: { id: booking.roomId },
      select: { venueId: true },
    });

    if (!room) {
      response.status(404).json({ error: 'Booking resource not found' });
      return;
    }

    authorizeBookingAccess(authenticatedRequest, {
      userId: booking.userId,
      venueId: room.venueId,
    });

    response.status(200).json(booking);
  } catch (error) {
    next(error);
  }
}

export async function getRoom(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const authenticatedRequest = requireAuthenticatedUser(request);
    const roomId = getResourceId(request);
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, venueId: true, name: true, capacity: true },
    });

    if (!room) {
      response.status(404).json({ error: 'Room not found' });
      return;
    }

    authorizeVenueAccess(authenticatedRequest, room.venueId);
    response.status(200).json(room);
  } catch (error) {
    next(error);
  }
}