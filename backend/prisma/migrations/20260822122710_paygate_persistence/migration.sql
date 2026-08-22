-- CreateEnum
CREATE TYPE "PaygateChargeStatus" AS ENUM ('PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaygateRefundStatus" AS ENUM ('PROCESSING', 'SUCCEEDED', 'FAILED');

-- DropIndex
DROP INDEX "rooms_amenities_gin_idx";

-- CreateTable
CREATE TABLE "paygate_charges" (
    "id" UUID NOT NULL,
    "charge_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "booking_reference" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PaygateChargeStatus" NOT NULL DEFAULT 'PROCESSING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paygate_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paygate_refunds" (
    "id" UUID NOT NULL,
    "refund_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "charge_id" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "status" "PaygateRefundStatus" NOT NULL DEFAULT 'PROCESSING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paygate_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "paygate_charges_charge_id_key" ON "paygate_charges"("charge_id");

-- CreateIndex
CREATE UNIQUE INDEX "paygate_charges_idempotency_key_key" ON "paygate_charges"("idempotency_key");

-- CreateIndex
CREATE INDEX "paygate_charges_booking_reference_idx" ON "paygate_charges"("booking_reference");

-- CreateIndex
CREATE UNIQUE INDEX "paygate_refunds_refund_id_key" ON "paygate_refunds"("refund_id");

-- CreateIndex
CREATE UNIQUE INDEX "paygate_refunds_idempotency_key_key" ON "paygate_refunds"("idempotency_key");

-- AddForeignKey
ALTER TABLE "paygate_refunds" ADD CONSTRAINT "paygate_refunds_charge_id_fkey" FOREIGN KEY ("charge_id") REFERENCES "paygate_charges"("charge_id") ON DELETE RESTRICT ON UPDATE CASCADE;
