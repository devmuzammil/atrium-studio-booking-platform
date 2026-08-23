import { Prisma, PrismaClient } from '@prisma/client';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function invalid(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') invalid(`${name} is required`);
  return value.trim();
}

function requiredUuid(value: unknown, name: string): string {
  const result = requiredString(value, name);
  if (!uuidPattern.test(result)) invalid(`${name} must be a valid UUID`);
  return result;
}

function integerAtLeast(value: unknown, name: string, minimum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    invalid(`${name} must be an integer of at least ${minimum}`);
  }
  return value;
}

function optionalIntegerAtLeast(value: unknown, name: string, minimum: number): number | undefined {
  if (value === undefined) return undefined;
  return integerAtLeast(value, name, minimum);
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, name);
}

function optionalAmenities(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((amenity) => typeof amenity !== 'string' || amenity.trim() === '')) {
    invalid('amenities must be an array of non-empty strings');
  }
  return value as Prisma.InputJsonValue;
}

function ensureDurationBounds(minimum: number | undefined, maximum: number | undefined): void {
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    invalid('minDurationMinutes must not exceed maxDurationMinutes');
  }
}

export async function listRooms(database: PrismaClient, venueId: string) {
  return database.room.findMany({ where: { venueId }, orderBy: { name: 'asc' } });
}

export async function createRoom(database: PrismaClient, input: Record<string, unknown>) {
  const venueId = requiredUuid(input.venueId, 'venueId');
  const name = requiredString(input.name, 'name');
  const capacity = integerAtLeast(input.capacity, 'capacity', 1);
  const hourlyRateMinor = integerAtLeast(input.hourlyRateMinor, 'hourlyRateMinor', 0);
  const minDurationMinutes = integerAtLeast(input.minDurationMinutes ?? 60, 'minDurationMinutes', 30);
  const maxDurationMinutes = integerAtLeast(input.maxDurationMinutes ?? 480, 'maxDurationMinutes', minDurationMinutes);
  const overbookingPercent = integerAtLeast(input.overbookingPercent ?? 0, 'overbookingPercent', 0);
  if (overbookingPercent > 10) invalid('overbookingPercent must not exceed 10');
  ensureDurationBounds(minDurationMinutes, maxDurationMinutes);
  return database.room.create({
    data: {
      venueId, name, capacity, hourlyRateMinor,
      currency: optionalString(input.currency, 'currency') ?? 'PKR',
      amenities: optionalAmenities(input.amenities) ?? [],
      minDurationMinutes, maxDurationMinutes, overbookingPercent,
    },
  });
}

export async function updateRoom(database: PrismaClient, roomId: string, input: Record<string, unknown>) {
  const existing = await database.room.findUnique({ where: { id: roomId } });
  if (!existing) return null;
  const minDurationMinutes = optionalIntegerAtLeast(input.minDurationMinutes, 'minDurationMinutes', 30);
  const maxDurationMinutes = optionalIntegerAtLeast(input.maxDurationMinutes, 'maxDurationMinutes', 30);
  ensureDurationBounds(minDurationMinutes ?? existing.minDurationMinutes, maxDurationMinutes ?? existing.maxDurationMinutes);
  const overbookingPercent = optionalIntegerAtLeast(input.overbookingPercent, 'overbookingPercent', 0);
  if (overbookingPercent !== undefined && overbookingPercent > 10) invalid('overbookingPercent must not exceed 10');
  return database.room.update({
    where: { id: roomId },
    data: {
      ...(input.name === undefined ? {} : { name: requiredString(input.name, 'name') }),
      ...(input.capacity === undefined ? {} : { capacity: integerAtLeast(input.capacity, 'capacity', 1) }),
      ...(input.hourlyRateMinor === undefined ? {} : { hourlyRateMinor: integerAtLeast(input.hourlyRateMinor, 'hourlyRateMinor', 0) }),
      ...(input.currency === undefined ? {} : { currency: requiredString(input.currency, 'currency') }),
      ...(input.amenities === undefined ? {} : { amenities: optionalAmenities(input.amenities) }),
      ...(minDurationMinutes === undefined ? {} : { minDurationMinutes }),
      ...(maxDurationMinutes === undefined ? {} : { maxDurationMinutes }),
      ...(overbookingPercent === undefined ? {} : { overbookingPercent }),
    },
  });
}

export async function createEquipment(database: PrismaClient, input: Record<string, unknown>) {
  const venueId = requiredUuid(input.venueId, 'venueId');
  const name = requiredString(input.name, 'name');
  const hourlyRateMinor = integerAtLeast(input.hourlyRateMinor, 'hourlyRateMinor', 0);
  const totalUnits = integerAtLeast(input.totalUnits, 'totalUnits', 1);
  const overbookingPercent = integerAtLeast(input.overbookingPercent ?? 0, 'overbookingPercent', 0);
  if (overbookingPercent > 10) invalid('overbookingPercent must not exceed 10');
  return database.equipmentType.create({
    data: { venueId, name, hourlyRateMinor, totalUnits, overbookingPercent, currency: optionalString(input.currency, 'currency') ?? 'PKR' },
  });
}

export async function updateEquipment(database: PrismaClient, equipmentId: string, input: Record<string, unknown>) {
  const existing = await database.equipmentType.findUnique({ where: { id: equipmentId } });
  if (!existing) return null;
  const overbookingPercent = optionalIntegerAtLeast(input.overbookingPercent, 'overbookingPercent', 0);
  if (overbookingPercent !== undefined && overbookingPercent > 10) invalid('overbookingPercent must not exceed 10');
  return database.equipmentType.update({
    where: { id: equipmentId },
    data: {
      ...(input.name === undefined ? {} : { name: requiredString(input.name, 'name') }),
      ...(input.hourlyRateMinor === undefined ? {} : { hourlyRateMinor: integerAtLeast(input.hourlyRateMinor, 'hourlyRateMinor', 0) }),
      ...(input.totalUnits === undefined ? {} : { totalUnits: integerAtLeast(input.totalUnits, 'totalUnits', 1) }),
      ...(input.currency === undefined ? {} : { currency: requiredString(input.currency, 'currency') }),
      ...(overbookingPercent === undefined ? {} : { overbookingPercent }),
    },
  });
}

export async function deleteRoom(database: PrismaClient, roomId: string): Promise<void> {
  await database.room.delete({ where: { id: roomId } });
}

export async function deleteEquipment(database: PrismaClient, equipmentId: string): Promise<void> {
  await database.equipmentType.delete({ where: { id: equipmentId } });
}