import { BookingStatus, Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  BookingTransactionClient,
  transitionBookingInTransaction,
} from './bookingStateMachine';

const ACTIVE_STATUSES = ['HELD', 'PENDING_PAYMENT', 'CONFIRMED'] as const;
const HOLD_MINUTES = 8;
const CHECKOUT_MINUTES = 10;
const TURNAROUND_MINUTES = 15;

export interface EquipmentHoldRequest {
  equipmentTypeId: string;
  quantity: number;
}

export interface CreateHoldInput {
  userId: string;
  roomId: string;
  start: Date;
  end: Date;
  equipment: EquipmentHoldRequest[];
}

export interface CreatedHold {
  id: string;
  status: BookingStatus;
  holdExpiresAt: Date;
  checkoutDeadline: Date;
  amountMinor: number;
  currency: string;
}

export class HoldValidationError extends Error {
  readonly statusCode = 400;
}

export class InventoryUnavailableError extends Error {
  readonly statusCode = 409;
}

function isConcurrencyConflict(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined;
  return (error instanceof Error && error.message.includes('23P01')) || code === 'P2034';
}

function localTimeParts(date: Date, timezone: string): { day: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { day: values.weekday, time: `${values.hour}:${values.minute}` };
}

function isWithinOperatingHours(schedule: Prisma.JsonValue, date: Date, end: Date, timezone: string): boolean {
  if (typeof schedule !== 'object' || schedule === null || Array.isArray(schedule)) {
    return false;
  }

  const startParts = localTimeParts(date, timezone);
  const endParts = localTimeParts(end, timezone);
  if (startParts.day !== endParts.day) {
    return false;
  }

  const daySchedule = (schedule as Record<string, Prisma.JsonValue>)[startParts.day]
    ?? (schedule as Record<string, Prisma.JsonValue>)[startParts.day.toLowerCase()];
  const windows = Array.isArray(daySchedule) ? daySchedule : [daySchedule];

  return windows.some((window) => {
    if (typeof window !== 'object' || window === null || Array.isArray(window)) {
      return false;
    }
    const opening = window as Record<string, Prisma.JsonValue>;
    return typeof opening.open === 'string'
      && typeof opening.close === 'string'
      && startParts.time >= opening.open
      && endParts.time <= opening.close;
  });
}

function assertValidInterval(start: Date, end: Date, now: Date): void {
  const durationMinutes = (end.getTime() - start.getTime()) / 60000;
  const advanceMinutes = (start.getTime() - now.getTime()) / 60000;

  if (!Number.isFinite(durationMinutes) || start >= end) {
    throw new HoldValidationError('start must be before end');
  }
  if (start.getUTCMinutes() % 30 !== 0 || end.getUTCMinutes() % 30 !== 0
    || start.getUTCSeconds() !== 0 || end.getUTCSeconds() !== 0
    || start.getUTCMilliseconds() !== 0 || end.getUTCMilliseconds() !== 0) {
    throw new HoldValidationError('booking times must use 30-minute increments');
  }
  if (durationMinutes < 60 || durationMinutes > 480) {
    throw new HoldValidationError('booking duration must be between 1 and 8 hours');
  }
  if (advanceMinutes < 60 || advanceMinutes > 90 * 24 * 60) {
    throw new HoldValidationError('booking must be between 1 hour and 90 days ahead');
  }
}

async function lockEquipment(
  transaction: BookingTransactionClient,
  equipment: EquipmentHoldRequest[],
  venueId: string,
  start: Date,
  end: Date,
): Promise<Array<{ id: string; hourlyRateMinor: number; currency: string; totalUnits: number; overbookingPercent: number }>> {
  const ids = [...new Set(equipment.map((item) => item.equipmentTypeId))].sort();
  if (ids.length === 0) {
    return [];
  }

  const locked = await transaction.$queryRaw<Array<{
    id: string;
    venueId: string;
    hourlyRateMinor: number;
    currency: string;
    totalUnits: number;
    overbookingPercent: number;
  }>>(Prisma.sql`
    SELECT id, venue_id AS "venueId", hourly_rate_minor AS "hourlyRateMinor",
      currency, total_units AS "totalUnits", overbooking_percent AS "overbookingPercent"
    FROM equipment_types
    WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
    ORDER BY id
    FOR UPDATE
  `);

  if (locked.length !== ids.length || locked.some((item) => item.venueId !== venueId)) {
    throw new HoldValidationError('equipment must belong to the room venue');
  }

  for (const item of equipment) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new HoldValidationError('equipment quantity must be a positive integer');
    }
    const inventory = locked.find((candidate) => candidate.id === item.equipmentTypeId);
    if (!inventory) {
      throw new HoldValidationError('equipment type was not found');
    }
    const effectiveCapacity = Math.floor(inventory.totalUnits * (1 + inventory.overbookingPercent / 100));
    if (item.quantity > effectiveCapacity) {
      throw new InventoryUnavailableError('requested equipment quantity exceeds capacity');
    }

    const result = await transaction.$queryRaw<Array<{ maxQuantity: number }>>(Prisma.sql`
      SELECT COALESCE(MAX(running_quantity), 0)::int AS "maxQuantity"
      FROM (
        SELECT SUM(delta) OVER (ORDER BY point, delta DESC ROWS UNBOUNDED PRECEDING) AS running_quantity
        FROM (
          SELECT lower(ir.slot) AS point, ir.quantity AS delta
          FROM inventory_reservations ir
          INNER JOIN bookings b ON b.id = ir.booking_id
          WHERE ir.equipment_type_id = ${item.equipmentTypeId}::uuid
            AND b.status IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED')
            AND ir.slot && tstzrange(${start}, ${end}, '[)')
          UNION ALL
          SELECT upper(ir.slot) AS point, -ir.quantity AS delta
          FROM inventory_reservations ir
          INNER JOIN bookings b ON b.id = ir.booking_id
          WHERE ir.equipment_type_id = ${item.equipmentTypeId}::uuid
            AND b.status IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED')
            AND ir.slot && tstzrange(${start}, ${end}, '[)')
        ) events
      ) quantities
    `);

    if ((result[0]?.maxQuantity ?? 0) + item.quantity > effectiveCapacity) {
      throw new InventoryUnavailableError('equipment is unavailable for the requested interval');
    }
  }

  return locked;
}

export async function createBookingHold(
  database: PrismaClient,
  input: CreateHoldInput,
): Promise<CreatedHold> {
  const now = new Date();
  assertValidInterval(input.start, input.end, now);

  try {
    return await database.$transaction(async (transaction) => {
    const room = await transaction.room.findUnique({
      where: { id: input.roomId },
      select: {
        id: true,
        venueId: true,
        hourlyRateMinor: true,
        currency: true,
        minDurationMinutes: true,
        maxDurationMinutes: true,
        venue: { select: { timezone: true, operatingSchedule: true } },
      },
    });

    if (!room) {
      throw new HoldValidationError('room was not found');
    }

    const durationMinutes = (input.end.getTime() - input.start.getTime()) / 60000;
    if (durationMinutes < room.minDurationMinutes || durationMinutes > room.maxDurationMinutes) {
      throw new HoldValidationError('booking duration is outside room limits');
    }
    if (!isWithinOperatingHours(room.venue.operatingSchedule, input.start, input.end, room.venue.timezone)) {
      throw new HoldValidationError('booking is outside venue operating hours');
    }

    const equipment = await lockEquipment(transaction, input.equipment, room.venueId, input.start, input.end);
    const hours = durationMinutes / 60;
    const equipmentById = new Map(equipment.map((item) => [item.id, item]));
    const equipmentAmount = input.equipment.reduce((total, item) => {
      const inventory = equipmentById.get(item.equipmentTypeId);
      return total + Math.round((inventory?.hourlyRateMinor ?? 0) * item.quantity * hours);
    }, 0);
    const amountMinor = Math.round(room.hourlyRateMinor * hours) + equipmentAmount;
    const currency = room.currency;
    const holdExpiresAt = new Date(now.getTime() + HOLD_MINUTES * 60000);
    const checkoutDeadline = new Date(now.getTime() + CHECKOUT_MINUTES * 60000);
    const bookingId = randomUUID();
    const protectedStart = new Date(input.start.getTime() - TURNAROUND_MINUTES * 60000);
    const protectedEnd = new Date(input.end.getTime() + TURNAROUND_MINUTES * 60000);
    const policy = await transaction.cancellationPolicy.findFirst({
      where: { venueId: room.venueId, active: true },
      orderBy: { version: 'desc' },
      select: { version: true, tiers: true },
    });

    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO bookings (
        id, user_id, room_id, slot, protected_slot, status, amount_minor, currency,
        pricing_snapshot, policy_snapshot, hold_expires_at, checkout_deadline, created_at, updated_at
      ) VALUES (
        ${bookingId}::uuid, ${input.userId}::uuid, ${room.id}::uuid,
        tstzrange(${input.start}, ${input.end}, '[)'),
        tstzrange(${protectedStart}, ${protectedEnd}, '[)'),
        'DRAFT', ${amountMinor}, ${currency},
        ${JSON.stringify({ roomRateMinor: room.hourlyRateMinor, equipment })}::jsonb,
        ${JSON.stringify(policy ?? {})}::jsonb, ${holdExpiresAt}, ${checkoutDeadline}, now(), now()
      )
    `);

    if (input.equipment.length > 0) {
      await transaction.bookingLineItem.createMany({
        data: input.equipment.map((item) => {
          const inventory = equipmentById.get(item.equipmentTypeId);
          return {
            bookingId,
            equipmentTypeId: item.equipmentTypeId,
            quantity: item.quantity,
            unitRateMinor: inventory?.hourlyRateMinor ?? 0,
            currency: inventory?.currency ?? currency,
          };
        }),
      });

      for (const item of input.equipment) {
        await transaction.$executeRaw(Prisma.sql`
          INSERT INTO inventory_reservations
            (id, booking_id, inventory_type, equipment_type_id, quantity, slot, created_at)
          VALUES
            (${randomUUID()}::uuid, ${bookingId}::uuid, 'EQUIPMENT',
             ${item.equipmentTypeId}::uuid, ${item.quantity},
             tstzrange(${input.start}, ${input.end}, '[)'), now())
        `);
      }
    }

    await transitionBookingInTransaction(transaction, {
      bookingId,
      to: BookingStatus.HELD,
      actorId: input.userId,
      reason: 'booking hold created',
    });

      return { id: bookingId, status: BookingStatus.HELD, holdExpiresAt, checkoutDeadline, amountMinor, currency };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (isConcurrencyConflict(error)) {
      throw new InventoryUnavailableError('room is unavailable for the requested interval');
    }
    throw error;
  }
}