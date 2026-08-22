ALTER TABLE "payment_events" ADD COLUMN "correlation_id" TEXT;
CREATE INDEX "payment_events_correlation_id_idx" ON "payment_events"("correlation_id");