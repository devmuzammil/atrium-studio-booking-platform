import { Prisma, PrismaClient } from '@prisma/client';

export async function getVenueReport(database: PrismaClient, venueId?: string, start?: Date, end?: Date) {
  return database.$queryRaw<Array<{ venueId: string; venueName: string; revenueMinor: number; confirmedBookings: number; bookedMinutes: number }>>(Prisma.sql`
    SELECT v.id AS "venueId", v.name AS "venueName",
      COALESCE(SUM(CASE WHEN p.status = 'SUCCEEDED' THEN p.amount_minor ELSE 0 END), 0)::int AS "revenueMinor",
      COUNT(DISTINCT b.id)::int AS "confirmedBookings",
      COALESCE(SUM(EXTRACT(EPOCH FROM (upper(b.slot) - lower(b.slot))) / 60), 0)::int AS "bookedMinutes"
    FROM venues v
    LEFT JOIN rooms r ON r.venue_id = v.id
    LEFT JOIN bookings b ON b.room_id = r.id AND b.status IN ('CONFIRMED', 'COMPLETED')
      AND lower(b.slot) >= COALESCE(${start ?? new Date(0)}, lower(b.slot))
      AND lower(b.slot) < COALESCE(${end ?? new Date('9999-12-31')}, lower(b.slot))
    LEFT JOIN payments p ON p.booking_id = b.id
    WHERE (${venueId ?? null}::uuid IS NULL OR v.id = ${venueId ?? null}::uuid)
    GROUP BY v.id, v.name ORDER BY v.name
  `);
}