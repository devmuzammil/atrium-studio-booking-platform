CREATE TYPE "WebhookJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'RETRY', 'DEAD_LETTER');

CREATE TABLE "webhook_jobs" (
    "id" UUID NOT NULL,
    "payment_event_id" UUID NOT NULL,
    "status" "WebhookJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    CONSTRAINT "webhook_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "webhook_jobs_payment_event_id_key" ON "webhook_jobs"("payment_event_id");
CREATE INDEX "webhook_jobs_status_next_attempt_at_idx" ON "webhook_jobs"("status", "next_attempt_at");
CREATE INDEX "webhook_jobs_status_locked_at_idx" ON "webhook_jobs"("status", "locked_at");
ALTER TABLE "webhook_jobs" ADD CONSTRAINT "webhook_jobs_payment_event_id_fkey" FOREIGN KEY ("payment_event_id") REFERENCES "payment_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;