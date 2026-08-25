import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { authorizeHoldCreation, requireAuthenticatedUser } from '../middleware/authorization';
import { createBookingHold, CreateHoldInput, HoldValidationError } from '../services/bookingHoldService';

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HoldValidationError(`${name} is required`);
  }
  return value.trim();
}

function parseDate(value: unknown, name: string): Date {
  const date = new Date(requiredString(value, name));
  if (Number.isNaN(date.getTime())) {
    throw new HoldValidationError(`${name} must be a valid timestamp`);
  }
  return date;
}

function parseEquipment(value: unknown): CreateHoldInput['equipment'] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new HoldValidationError('equipment must be an array');
  }

  return value.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new HoldValidationError('equipment items must be objects');
    }
    const equipmentItem = item as Record<string, unknown>;
    const quantity = equipmentItem.quantity;
    if (typeof quantity !== 'number' || !Number.isInteger(quantity)) {
      throw new HoldValidationError('equipment quantity must be a positive integer');
    }
    return {
      equipmentTypeId: requiredString(equipmentItem.equipmentTypeId, 'equipmentTypeId'),
      quantity,
    };
  });
}

export async function createHold(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const authenticatedRequest = requireAuthenticatedUser(request);
    const userId = authenticatedRequest.user?.id;
    if (!userId) {
      throw new HoldValidationError('Authenticated user is required');
    }

    const input = {
      userId,
      roomId: requiredString(request.body?.roomId, 'roomId'),
      start: parseDate(request.body?.start, 'start'),
      end: parseDate(request.body?.end, 'end'),
      equipment: parseEquipment(request.body?.equipment),
    };

    const room = await prisma.room.findFirst({ where: { id: input.roomId, deletedAt: null }, select: { venueId: true } });
    if (!room) {
      response.status(404).json({ error: 'Room not found' });
      return;
    }
    authorizeHoldCreation(authenticatedRequest, room.venueId);

    const hold = await createBookingHold(prisma, input);
    response.status(201).json({ booking: hold });
  } catch (error) {
    next(error);
  }
}
