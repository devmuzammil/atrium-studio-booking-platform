import { Prisma, PrismaClient } from '@prisma/client';

export async function getVenueReport(database: PrismaClient, venueId?: string, start?: Date, end?: Date) {
  const boundedWindow = start !== undefined && end !== undefined;
  return database.$queryRaw<Array<{
    venueId: string;
    venueName: string;
    revenueMinor: number;
    confirmedBookings: number;
    bookedMinutes: number;
    utilizationPercent: number | null;
  }>>(Prisma.sql`
    WITH booking_metrics AS (
      SELECT b.id, b.room_id,
        EXTRACT(EPOCH FROM (upper(b.slot) - lower(b.slot))) / 60 AS booked_minutes,
        COALESCE(SUM(CASE WHEN p.status = 'SUCCEEDED' THEN p.amount_minor ELSE 0 END), 0)::int AS revenue_minor
      FROM bookings b
      LEFT JOIN payments p ON p.booking_id = b.id
      WHERE b.status IN ('CONFIRMED', 'COMPLETED')
        AND lower(b.slot) >= COALESCE(${start ?? new Date(0)}, lower(b.slot))
        AND lower(b.slot) < COALESCE(${end ?? new Date('9999-12-31')}, lower(b.slot))
      GROUP BY b.id, b.room_id, b.slot
    ), venue_metrics AS (
      SELECT v.id AS venue_id, v.name AS venue_name,
        COUNT(DISTINCT r.id)::int AS room_count,
        COALESCE(SUM(bm.revenue_minor), 0)::int AS revenue_minor,
        COUNT(DISTINCT bm.id)::int AS confirmed_bookings,
        COALESCE(SUM(bm.booked_minutes), 0)::int AS booked_minutes
      FROM venues v
      LEFT JOIN rooms r ON r.venue_id = v.id
      LEFT JOIN booking_metrics bm ON bm.room_id = r.id
      WHERE (${venueId ?? null}::uuid IS NULL OR v.id = ${venueId ?? null}::uuid)
      GROUP BY v.id, v.name
    )
    SELECT venue_id AS "venueId", venue_name AS "venueName", revenue_minor AS "revenueMinor",
      confirmed_bookings AS "confirmedBookings", booked_minutes AS "bookedMinutes",
      CASE WHEN ${boundedWindow} AND room_count > 0
        THEN ROUND((booked_minutes * 100.0) / (room_count * EXTRACT(EPOCH FROM (${end ?? new Date(0)} - ${start ?? new Date(0)}) / 60)), 2)
        ELSE NULL
      END AS "utilizationPercent"
    FROM venue_metrics
    ORDER BY venue_name
  `);
}