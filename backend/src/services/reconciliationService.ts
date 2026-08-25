import { Prisma, PrismaClient } from '@prisma/client';

export async function getReconciliation(database: PrismaClient, venueId?: string) {
  const rows = await database.$queryRaw<Array<{
    chargeId: string;
    chargeAmount: number;
    chargeCurrency: string;
    bookingId: string | null;
    bookingStatus: string | null;
    paymentAmount: number | null;
    paymentCurrency: string | null;
    successfulRefundCount: number;
    refundAmount: number | null;
    issue: string | null;
  }>>(Prisma.sql`
    SELECT c.charge_id AS "chargeId", c.amount_minor AS "chargeAmount", c.currency AS "chargeCurrency",
      p.booking_id AS "bookingId", b.status::text AS "bookingStatus",
      p.amount_minor AS "paymentAmount", p.currency AS "paymentCurrency",
      COUNT(r.id) FILTER (WHERE r.status IN ('SUCCEEDED', 'REFUNDED'))::int AS "successfulRefundCount",
      COALESCE(SUM(r.amount_minor) FILTER (WHERE r.status IN ('SUCCEEDED', 'REFUNDED')), 0)::int AS "refundAmount",
      CASE
        WHEN p.id IS NULL THEN 'unknown_charge'
        WHEN p.amount_minor <> c.amount_minor OR p.currency <> c.currency THEN 'amount_or_currency_mismatch'
        WHEN b.id IS NULL THEN 'missing_booking'
        WHEN b.status::text IN ('CONFIRMED', 'COMPLETED') AND COUNT(r.id) FILTER (WHERE r.status IN ('SUCCEEDED', 'REFUNDED')) > 0 THEN 'multiple_outcomes'
        WHEN b.status::text NOT IN ('CONFIRMED', 'COMPLETED') AND COUNT(r.id) FILTER (WHERE r.status IN ('SUCCEEDED', 'REFUNDED')) = 0 THEN 'not_confirmed_or_refunded'
        WHEN b.status::text NOT IN ('CONFIRMED', 'COMPLETED') AND COUNT(r.id) FILTER (WHERE r.status IN ('SUCCEEDED', 'REFUNDED')) <> 1 THEN 'multiple_refunds'
        WHEN b.status::text NOT IN ('CONFIRMED', 'COMPLETED') AND COALESCE(SUM(r.amount_minor) FILTER (WHERE r.status IN ('SUCCEEDED', 'REFUNDED')), 0) <> c.amount_minor THEN 'incorrect_refund_amount'
        ELSE NULL
      END AS issue
    FROM paygate_charges c
    LEFT JOIN payments p ON p.provider_charge_id = c.charge_id
    LEFT JOIN bookings b ON b.id = p.booking_id
    LEFT JOIN refunds r ON r.payment_id = p.id
    LEFT JOIN rooms room ON room.id = b.room_id
    WHERE c.status = 'SUCCEEDED'
      AND (${venueId ?? null}::uuid IS NULL OR room.venue_id = ${venueId ?? null}::uuid)
    GROUP BY c.charge_id, c.amount_minor, c.currency, p.id, p.booking_id, p.amount_minor, p.currency, b.id, b.status
    ORDER BY c.charge_id
  `);
  const discrepancies = rows.filter((row) => row.issue !== null);
  return {
    capturedCharges: rows.length,
    reconciledCharges: rows.length - discrepancies.length,
    discrepancies,
  };
}