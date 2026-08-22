import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { searchAvailableRooms } from '../services/roomAvailabilityService';

class InvalidRoomSearchError extends Error {
  readonly statusCode = 400;
}

function queryString(value: unknown, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidRoomSearchError(`${name} must be a non-empty string`);
  }

  return value.trim();
}

function queryNumber(value: unknown, name: string, minimum: number): number | undefined {
  const text = queryString(value, name);
  if (text === undefined) {
    return undefined;
  }

  const number = Number(text);
  if (!Number.isInteger(number) || number < minimum) {
    throw new InvalidRoomSearchError(`${name} must be an integer of at least ${minimum}`);
  }

  return number;
}

function parseDate(value: unknown, name: string): Date {
  const text = queryString(value, name);
  if (!text) {
    throw new InvalidRoomSearchError(`${name} is required`);
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw new InvalidRoomSearchError(`${name} must be a valid timestamp`);
  }

  return date;
}

function parseAmenities(value: unknown): string[] | undefined {
  const text = queryString(value, 'amenities');
  if (text === undefined) {
    return undefined;
  }

  const amenities = text.split(',').map((amenity) => amenity.trim()).filter(Boolean);
  if (amenities.length === 0 || amenities.some((amenity) => amenity.length > 80)) {
    throw new InvalidRoomSearchError('amenities must be a comma-separated set of names');
  }

  return [...new Set(amenities)];
}

export async function searchRooms(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const start = parseDate(request.query.start, 'start');
    const end = parseDate(request.query.end, 'end');
    const maxWindowMilliseconds = 7 * 24 * 60 * 60 * 1000;

    if (start >= end) {
      throw new InvalidRoomSearchError('start must be before end');
    }
    if (end.getTime() - start.getTime() > maxWindowMilliseconds) {
      throw new InvalidRoomSearchError('availability window cannot exceed 7 days');
    }

    const rooms = await searchAvailableRooms(prisma, {
      city: queryString(request.query.city, 'city'),
      minCapacity: queryNumber(request.query.minCapacity, 'minCapacity', 1),
      amenities: parseAmenities(request.query.amenities),
      maxPrice: queryNumber(request.query.maxPrice, 'maxPrice', 0),
      start,
      end,
    });

    response.status(200).json({ rooms });
  } catch (error) {
    next(error);
  }
}