import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { authorizeBookingAccess, authorizeVenueAccess, requireAuthenticatedUser } from '../middleware/authorization';
import { getBookingDetail, listBookingsForUser } from '../services/bookingQueryService';

function getResourceId(request: Request): string {
  const resourceId = request.params.id;
  if (typeof resourceId !== 'string') {
    throw new Error('Resource ID must be a string');
  }

  return resourceId;
}

export async function listBookings(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const authenticatedRequest = requireAuthenticatedUser(request);
    const venueId = typeof request.query.venueId === 'string' ? request.query.venueId : undefined;
    const status = typeof request.query.status === 'string' ? request.query.status : undefined;
    const bookings = await listBookingsForUser(prisma, authenticatedRequest, { venueId, status });
    response.status(200).json({ bookings });
  } catch (error) {
    next(error);
  }
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

    const detail = await getBookingDetail(prisma, bookingId);
    response.status(200).json(detail ?? booking);
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
      select: {
        id: true,
        venueId: true,
        name: true,
        capacity: true,
        hourlyRateMinor: true,
        currency: true,
        amenities: true,
        minDurationMinutes: true,
        maxDurationMinutes: true,
        venue: { select: { id: true, name: true, city: true } },
      },
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

export async function listVenueEquipment(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    requireAuthenticatedUser(request);
    const venueId = request.params.venueId;
    if (typeof venueId !== 'string') {
      response.status(400).json({ error: 'venueId is required' });
      return;
    }

    const venue = await prisma.venue.findUnique({ where: { id: venueId }, select: { id: true } });
    if (!venue) {
      response.status(404).json({ error: 'Venue not found' });
      return;
    }

    const equipment = await prisma.equipmentType.findMany({
      where: { venueId },
      select: {
        id: true,
        venueId: true,
        name: true,
        hourlyRateMinor: true,
        currency: true,
        totalUnits: true,
        overbookingPercent: true,
      },
      orderBy: { name: 'asc' },
    });

    response.status(200).json({ equipment });
  } catch (error) {
    next(error);
  }
}
