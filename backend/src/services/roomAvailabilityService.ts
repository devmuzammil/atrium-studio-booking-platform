import { Prisma, PrismaClient } from '@prisma/client';

export interface RoomSearchFilters {
  city?: string;
  minCapacity?: number;
  amenities?: string[];
  maxPrice?: number;
  start: Date;
  end: Date;
}

export interface AvailableRoom {
  id: string;
  venueId: string;
  venueName: string;
  city: string;
  name: string;
  capacity: number;
  hourlyRateMinor: number;
  currency: string;
  amenities: Prisma.JsonValue;
}

export async function searchAvailableRooms(
  database: PrismaClient,
  filters: RoomSearchFilters,
): Promise<AvailableRoom[]> {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`NOT EXISTS (
      SELECT 1
      FROM bookings b
      WHERE b.room_id = r.id
        AND b.status IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED')
        AND b.protected_slot && tstzrange(
          ${filters.start},
          ${filters.end} + INTERVAL '15 minutes',
          '[)'
        )
    )`,
  ];

  if (filters.city) {
    conditions.push(Prisma.sql`v.city = ${filters.city}`);
  }
  if (filters.minCapacity !== undefined) {
    conditions.push(Prisma.sql`r.capacity >= ${filters.minCapacity}`);
  }
  if (filters.amenities && filters.amenities.length > 0) {
    conditions.push(Prisma.sql`r.amenities @> ${JSON.stringify(filters.amenities)}::jsonb`);
  }
  if (filters.maxPrice !== undefined) {
    conditions.push(Prisma.sql`r.hourly_rate_minor <= ${filters.maxPrice}`);
  }

  return database.$queryRaw<AvailableRoom[]>(Prisma.sql`
    SELECT
      r.id,
      r.venue_id AS "venueId",
      v.name AS "venueName",
      v.city,
      r.name,
      r.capacity,
      r.hourly_rate_minor AS "hourlyRateMinor",
      r.currency,
      r.amenities
    FROM rooms r
    INNER JOIN venues v ON v.id = r.venue_id
    WHERE ${Prisma.join(conditions, ' AND ')}
    ORDER BY v.city, v.name, r.name
  `);
}