CREATE TYPE "VehicleStatus" AS ENUM ('AVAILABLE', 'CLEANING', 'MAINTENANCE', 'INACTIVE');

ALTER TABLE "cars"
  ADD COLUMN "operationalStatus" "VehicleStatus" NOT NULL DEFAULT 'AVAILABLE',
  ADD COLUMN "exteriorColor" TEXT,
  ADD COLUMN "odometerKm" INTEGER,
  ADD COLUMN "vin" TEXT;

-- A legacy closed vehicle has no recorded maintenance reason.
UPDATE "cars" SET "operationalStatus" = 'INACTIVE' WHERE "isAvailable" = false;
ALTER TABLE "cars" ADD CONSTRAINT "cars_odometer_nonnegative" CHECK ("odometerKm" IS NULL OR "odometerKm" >= 0);
ALTER TABLE "car_movements" ADD COLUMN "note" TEXT;
