import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';
import { prisma } from '../config/prisma';
import { authorizeBookingAccess, authorizeVenueAccess, authorizeVenueAdmin, requireAuthenticatedUser } from '../middleware/authorization';
import { getBookingDetail, listBookingsForUser } from '../services/bookingQueryService';
import { beginCheckout } from '../services/checkoutService';
import { getRoomAvailability } from '../services/roomAvailabilityService';
import { getActivePolicy, parsePolicyTiers, replaceActivePolicy } from '../services/cancellationPolicyService';
import { createEquipment, createRoom, deleteEquipment, deleteRoom, listRooms, updateEquipment, updateRoom } from '../services/inventoryManagementService';

function body(request: Request): Record<string, unknown> {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
    throw Object.assign(new Error('request body must be an object'), { statusCode: 400 });
  }
  return request.body as Record<string, unknown>;
}

function venueIdParam(request: Request): string {
  const venueId = request.params.venueId;
  if (typeof venueId !== 'string' || venueId.trim() === '') throw Object.assign(new Error('venueId is required'), { statusCode: 400 });
  return venueId;
}

async function managedResourceVenue(resource: { venueId: string } | null): Promise<string> {
  if (!resource) throw Object.assign(new Error('Resource not found'), { statusCode: 404 });
  return resource.venueId;
}

export async function listManagedRooms(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const authenticated = requireAuthenticatedUser(request);
    const venueId = venueIdParam(request);
    authorizeVenueAdmin(authenticated, venueId);
    response.json({ rooms: await listRooms(prisma, venueId) });
  } catch (error) { next(error); }
}

export async function createManagedRoom(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const authenticated = requireAuthenticatedUser(request);
    const venueId = venueIdParam(request);
    authorizeVenueAdmin(authenticated, venueId);
    response.status(201).json({ room: await createRoom(prisma, { ...body(request), venueId }) });
  } catch (error) { next(error); }
}

export async function updateManagedRoom(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const authenticated = requireAuthenticatedUser(request);
    const roomId = getResourceId(request);
    const room = await prisma.room.findUnique({ where: { id: roomId }, select: { venueId: true } });
    authorizeVenueAdmin(authenticated, await managedResourceVenue(room));
    const updated = await updateRoom(prisma, roomId, body(request));
    response.json({ room: updated });
  } catch (error) { next(error); }
}

export async function deleteManagedRoom(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const authenticated = requireAuthenticatedUser(request);
    const roomId = getResourceId(request);
    const room = await prisma.room.findUnique({ where: { id: roomId }, select: { venueId: true } });
    authorizeVenueAdmin(authenticated, await managedResourceVenue(room));
    await deleteRoom(prisma, roomId);
    response.status(204).end();
  } catch (error) { next(error); }
}

export async function createManagedEquipment(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const authenticated = requireAuthenticatedUser(request);
    const venueId = venueIdParam(request);
    authorizeVenueAdmin(authenticated, venueId);
    response.status(201).json({ equipment: await createEquipment(prisma, { ...body(request), venueId }) });
  } catch (error) { next(error); }
}

export async function updateManagedEquipment(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const authenticated = requireAuthenticatedUser(request);
    const equipmentId = getResourceId(request);
    const equipment = await prisma.equipmentType.findUnique({ where: { id: equipmentId }, select: { venueId: true } });
    authorizeVenueAdmin(authenticated, await managedResourceVenue(equipment));
    response.json({ equipment: await updateEquipment(prisma, equipmentId, body(request)) });
  } catch (error) { next(error); }
}

export async function deleteManagedEquipment(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const authenticated = requireAuthenticatedUser(request);
    const equipmentId = getResourceId(request);
    const equipment = await prisma.equipmentType.findUnique({ where: { id: equipmentId }, select: { venueId: true } });
    authorizeVenueAdmin(authenticated, await managedResourceVenue(equipment));
    await deleteEquipment(prisma, equipmentId);
    response.status(204).end();
  } catch (error) { next(error); }
}

function getResourceId(request: Request): string {
  const resourceId = request.params.id;
  if (typeof resourceId !== 'string') {
    throw new Error('Resource ID must be a string');
  }

  return resourceId;
}

function parseWindow(request: Request): { start: Date; end: Date } {
  const startValue = request.query.start;
  const endValue = request.query.end;
  if (typeof startValue !== 'string' || typeof endValue !== 'string') {
    throw Object.assign(new Error('start and end are required'), { statusCode: 400 });
  }
  const start = new Date(startValue);
  const end = new Date(endValue);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    throw Object.assign(new Error('start must be before end'), { statusCode: 400 });
  }
  if (end.getTime() - start.getTime() > 7 * 24 * 60 * 60 * 1000) {
    throw Object.assign(new Error('availability window cannot exceed 7 days'), { statusCode: 400 });
  }
  return { start, end };
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

    authorizeVenueAccess(authenticatedRequest, room.venueId, [UserRole.CUSTOMER, UserRole.VENUE_STAFF, UserRole.VENUE_ADMIN]);
    response.status(200).json(room);
  } catch (error) {
    next(error);
  }
}

export async function listVenueEquipment(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const authenticatedRequest = requireAuthenticatedUser(request);
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
    authorizeVenueAccess(authenticatedRequest, venueId, [UserRole.CUSTOMER, UserRole.VENUE_STAFF, UserRole.VENUE_ADMIN]);

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

export async function getRoomAvailabilityWindow(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const authenticatedRequest = requireAuthenticatedUser(request);
    const roomId = getResourceId(request);
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, venueId: true },
    });
    if (!room) {
      response.status(404).json({ error: 'Room not found' });
      return;
    }
    authorizeVenueAccess(authenticatedRequest, room.venueId, [UserRole.CUSTOMER, UserRole.VENUE_STAFF, UserRole.VENUE_ADMIN]);
    const window = parseWindow(request);
    response.status(200).json(await getRoomAvailability(prisma, roomId, window.start, window.end));
  } catch (error) {
    next(error);
  }
}

export async function startCheckout(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const authenticated = requireAuthenticatedUser(request);
    const bookingId = getResourceId(request);
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { userId: true, room: { select: { venueId: true } } },
    });
    if (!booking) {
      response.status(404).json({ error: 'Booking not found' });
      return;
    }
    authorizeBookingAccess(authenticated, { userId: booking.userId, venueId: booking.room.venueId });
    const userId = authenticated.user?.id;
    if (!userId) {
      throw Object.assign(new Error('Authenticated user is required'), { statusCode: 401 });
    }
    const result = await beginCheckout(prisma, userId, bookingId);
    response.status(200).json({ booking: result });
  } catch (error) {
    next(error);
  }
}

export async function getVenuePolicy(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const authenticated = requireAuthenticatedUser(request);
    const venueId = request.params.venueId;
    if (typeof venueId !== 'string') {
      response.status(400).json({ error: 'venueId is required' });
      return;
    }
    authorizeVenueAccess(authenticated, venueId);
    response.status(200).json({ policy: await getActivePolicy(prisma, venueId) });
  } catch (error) {
    next(error);
  }
}

export async function putVenuePolicy(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const authenticated = requireAuthenticatedUser(request);
    const venueId = request.params.venueId;
    if (typeof venueId !== 'string') {
      response.status(400).json({ error: 'venueId is required' });
      return;
    }
    authorizeVenueAdmin(authenticated, venueId);
    const tiers = parsePolicyTiers(request.body?.tiers);
    const policy = await replaceActivePolicy(prisma, venueId, tiers);
    response.status(200).json({ policy });
  } catch (error) {
    next(error);
  }
}
