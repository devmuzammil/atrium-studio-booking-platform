import { Prisma, PrismaClient, UserRole } from '@prisma/client';
import { AuthenticatedRequest } from '../middleware/auth';
import { ForbiddenError, hasGlobalRole, hasVenueRole } from '../middleware/authorization';

export interface BookingDetail {
  id: string;
  userId: string;
  roomId: string;
  status: string;
  amountMinor: number;
  currency: string;
  holdExpiresAt: Date | null;
  checkoutDeadline: Date | null;
  createdAt: Date;
  updatedAt: Date;
  start: Date;
  end: Date;
  room: {
    id: string;
    name: string;
    capacity: number;
    hourlyRateMinor: number;
    venueId: string;
    venueName: string;
    city: string;
  };
  lineItems: Array<{
    id: string;
    equipmentTypeId: string;
    quantity: number;
    unitRateMinor: number;
    currency: string;
    equipmentName: string;
  }>;
  payments: Array<{
    id: string;
    status: string;
    amountMinor: number;
    currency: string;
    providerChargeId: string | null;
    createdAt: Date;
  }>;
  refunds: Array<{
    id: string;
    status: string;
    amountMinor: number;
    currency: string;
    providerRefundId: string | null;
    createdAt: Date;
  }>;
}

export async function getBookingDetail(
  database: PrismaClient,
  bookingId: string,
): Promise<BookingDetail | null> {
  const rows = await database.$queryRaw<Array<{
    id: string;
    userId: string;
    roomId: string;
    status: string;
    amountMinor: number;
    currency: string;
    holdExpiresAt: Date | null;
    checkoutDeadline: Date | null;
    createdAt: Date;
    updatedAt: Date;
    start: Date;
    end: Date;
    roomName: string;
    roomCapacity: number;
    roomHourlyRateMinor: number;
    venueId: string;
    venueName: string;
    city: string;
  }>>(Prisma.sql`
    SELECT
      b.id,
      b.user_id AS "userId",
      b.room_id AS "roomId",
      b.status::text AS status,
      b.amount_minor AS "amountMinor",
      b.currency,
      b.hold_expires_at AS "holdExpiresAt",
      b.checkout_deadline AS "checkoutDeadline",
      b.created_at AS "createdAt",
      b.updated_at AS "updatedAt",
      lower(b.slot) AS start,
      upper(b.slot) AS end,
      r.name AS "roomName",
      r.capacity AS "roomCapacity",
      r.hourly_rate_minor AS "roomHourlyRateMinor",
      r.venue_id AS "venueId",
      v.name AS "venueName",
      v.city
    FROM bookings b
    INNER JOIN rooms r ON r.id = b.room_id
    INNER JOIN venues v ON v.id = r.venue_id
    WHERE b.id = ${bookingId}::uuid
  `);

  if (rows.length === 0) {
    return null;
  }

  const booking = rows[0];
  const [lineItems, payments, refunds] = await Promise.all([
    database.$queryRaw<Array<{
      id: string;
      equipmentTypeId: string;
      quantity: number;
      unitRateMinor: number;
      currency: string;
      equipmentName: string;
    }>>(Prisma.sql`
      SELECT
        li.id,
        li.equipment_type_id AS "equipmentTypeId",
        li.quantity,
        li.unit_rate_minor AS "unitRateMinor",
        li.currency,
        et.name AS "equipmentName"
      FROM booking_line_items li
      INNER JOIN equipment_types et ON et.id = li.equipment_type_id
      WHERE li.booking_id = ${bookingId}::uuid
      ORDER BY et.name
    `),
    database.payment.findMany({
      where: { bookingId },
      select: {
        id: true,
        status: true,
        amountMinor: true,
        currency: true,
        providerChargeId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    database.refund.findMany({
      where: { bookingId },
      select: {
        id: true,
        status: true,
        amountMinor: true,
        currency: true,
        providerRefundId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  return {
    id: booking.id,
    userId: booking.userId,
    roomId: booking.roomId,
    status: booking.status,
    amountMinor: booking.amountMinor,
    currency: booking.currency,
    holdExpiresAt: booking.holdExpiresAt,
    checkoutDeadline: booking.checkoutDeadline,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    start: booking.start,
    end: booking.end,
    room: {
      id: booking.roomId,
      name: booking.roomName,
      capacity: booking.roomCapacity,
      hourlyRateMinor: booking.roomHourlyRateMinor,
      venueId: booking.venueId,
      venueName: booking.venueName,
      city: booking.city,
    },
    lineItems,
    payments,
    refunds,
  };
}

export async function listBookingsForUser(
  database: PrismaClient,
  request: AuthenticatedRequest,
  filters: { venueId?: string; status?: string },
): Promise<Array<{
  id: string;
  userId: string;
  roomId: string;
  status: string;
  amountMinor: number;
  currency: string;
  holdExpiresAt: Date | null;
  start: Date;
  end: Date;
  roomName: string;
  venueId: string;
  venueName: string;
  city: string;
  paymentStatus: string | null;
}>> {
  const user = request.user;
  if (!user) {
    throw new ForbiddenError();
  }

  const conditions: Prisma.Sql[] = [];

  if (hasGlobalRole(request, UserRole.PLATFORM_ADMIN)) {
    if (filters.venueId) {
      conditions.push(Prisma.sql`r.venue_id = ${filters.venueId}::uuid`);
    }
  } else if (user.roles.some((role) => role.role === UserRole.VENUE_ADMIN || role.role === UserRole.VENUE_STAFF)) {
    const venueIds = user.roles
      .filter((role) => role.role === UserRole.VENUE_ADMIN || role.role === UserRole.VENUE_STAFF)
      .map((role) => role.venueId);
    if (filters.venueId) {
      if (!hasVenueRole(request, filters.venueId, [UserRole.VENUE_ADMIN, UserRole.VENUE_STAFF])) {
        throw new ForbiddenError();
      }
      conditions.push(Prisma.sql`r.venue_id = ${filters.venueId}::uuid`);
    } else if (venueIds.length === 0) {
      throw new ForbiddenError();
    } else {
      conditions.push(Prisma.sql`r.venue_id IN (${Prisma.join(venueIds.map((id) => Prisma.sql`${id}::uuid`))})`);
    }
  } else {
    conditions.push(Prisma.sql`b.user_id = ${user.id}::uuid`);
  }

  if (filters.status) {
    conditions.push(Prisma.sql`b.status = ${filters.status}::"BookingStatus"`);
  }

  const whereClause = conditions.length > 0
    ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
    : Prisma.empty;

  return database.$queryRaw(Prisma.sql`
    SELECT
      b.id,
      b.user_id AS "userId",
      b.room_id AS "roomId",
      b.status::text AS status,
      b.amount_minor AS "amountMinor",
      b.currency,
      b.hold_expires_at AS "holdExpiresAt",
      lower(b.slot) AS start,
      upper(b.slot) AS end,
      r.name AS "roomName",
      r.venue_id AS "venueId",
      v.name AS "venueName",
      v.city,
      p.status::text AS "paymentStatus"
    FROM bookings b
    INNER JOIN rooms r ON r.id = b.room_id
    INNER JOIN venues v ON v.id = r.venue_id
    LEFT JOIN payments p ON p.booking_id = b.id
    ${whereClause}
    ORDER BY b.created_at DESC, b.id DESC
    LIMIT 100
  `);
}
