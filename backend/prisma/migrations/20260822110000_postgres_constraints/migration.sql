CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "rooms"
  ADD CONSTRAINT "rooms_capacity_positive"
  CHECK ("capacity" > 0),
  ADD CONSTRAINT "rooms_rates_non_negative"
  CHECK ("hourly_rate_minor" >= 0),
  ADD CONSTRAINT "rooms_overbooking_percent_valid"
  CHECK ("overbooking_percent" BETWEEN 0 AND 10),
  ADD CONSTRAINT "rooms_duration_valid"
  CHECK ("min_duration_minutes" >= 60 AND "max_duration_minutes" <= 480 AND "min_duration_minutes" <= "max_duration_minutes");

ALTER TABLE "equipment_types"
  ADD CONSTRAINT "equipment_total_units_positive"
  CHECK ("total_units" > 0),
  ADD CONSTRAINT "equipment_rates_non_negative"
  CHECK ("hourly_rate_minor" >= 0),
  ADD CONSTRAINT "equipment_overbooking_percent_valid"
  CHECK ("overbooking_percent" BETWEEN 0 AND 10);

ALTER TABLE "booking_line_items"
  ADD CONSTRAINT "booking_line_items_quantity_positive"
  CHECK ("quantity" > 0),
  ADD CONSTRAINT "booking_line_items_rate_non_negative"
  CHECK ("unit_rate_minor" >= 0);

ALTER TABLE "inventory_reservations"
  ADD CONSTRAINT "inventory_reservations_quantity_positive"
  CHECK ("quantity" > 0);

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_amount_non_negative"
  CHECK ("amount_minor" >= 0),
  ADD CONSTRAINT "bookings_slot_not_empty"
  CHECK (NOT isempty("slot")),
  ADD CONSTRAINT "bookings_protected_slot_not_empty"
  CHECK (NOT isempty("protected_slot"));

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_active_room_slot_exclusion"
  EXCLUDE USING GIST ("room_id" WITH =, "protected_slot" WITH &&)
  WHERE ("status" IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED'));

CREATE INDEX "bookings_active_room_slot_gist_idx"
  ON "bookings" USING GIST ("room_id", "protected_slot")
  WHERE "status" IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED');

CREATE INDEX "rooms_amenities_gin_idx"
  ON "rooms" USING GIN ("amenities");