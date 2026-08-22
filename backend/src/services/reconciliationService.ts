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
    refundAmount: number | null;
    issue: string | null;
  }>>(Prisma.sql`
    SELECT c.charge_id AS "chargeId", c.amount_minor AS "chargeAmount", c.currency AS "chargeCurrency",
      p.booking_id AS "bookingId", b.status::text AS "bookingStatus",
      p.amount_minor AS "paymentAmount", p.currency AS "paymentCurrency",
      r.amount_minor AS "refundAmount",
      CASE
        WHEN p.id IS NULL THEN 'unknown_charge'
        WHEN p.amount_minor <> c.amount_minor OR p.currency <> c.currency THEN 'amount_or_currency_mismatch'
        WHEN b.id IS NULL THEN 'missing_booking'
        WHEN b.status::text <> 'CONFIRMED' AND r.id IS NULL THEN 'not_confirmed_or_refunded'
        WHEN r.id IS NOT NULL AND r.amount_minor <> c.amount_minor THEN 'incorrect_refund_amount'
        ELSE NULL
      END AS issue
    FROM paygate_charges c
    LEFT JOIN payments p ON p.provider_charge_id = c.charge_id
    LEFT JOIN bookings b ON b.id = p.booking_id
    LEFT JOIN refunds r ON r.payment_id = p.id
    LEFT JOIN rooms room ON room.id = b.room_id
    WHERE c.status = 'SUCCEEDED'
      AND (${venueId ?? null}::uuid IS NULL OR room.venue_id = ${venueId ?? null}::uuid)
  `);
  return { discrepancies: rows.filter((row) => row.issue !== null), capturedCharges: rows.length };
}