BEGIN;
-- AlterTable
ALTER TABLE "cars" ADD COLUMN     "carModelLocationId" TEXT,
ADD COLUMN "availableFrom" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "carModelLocationId" TEXT,
ADD COLUMN     "carSnapshot" JSONB,
ADD COLUMN     "turnaroundMinutes" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "car_models" (
    "id" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 4,
    "transmission" TEXT NOT NULL DEFAULT 'Automatic',
    "fuelType" TEXT NOT NULL DEFAULT 'Gasoline',
    "imageUrl" TEXT,
    "options" JSONB,
    "featureCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "categories" "CarCategory"[] DEFAULT ARRAY[]::"CarCategory"[],
    "categoryLabel" TEXT,
    "steeringSide" "SteeringSide" NOT NULL DEFAULT 'RHD',
    "transmissionType" "TransmissionType" NOT NULL DEFAULT 'AUTOMATIC',
    "luggageCapacity" INTEGER NOT NULL DEFAULT 2,
    "description" TEXT,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "badge" TEXT,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "recommendationOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "car_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "car_model_locations" (
    "id" TEXT NOT NULL,
    "carModelId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "providerName" TEXT NOT NULL DEFAULT 'FUNCH Rental',
    "hourlyRate" DECIMAL(12,2) NOT NULL,
    "dailyRate" DECIMAL(12,2) NOT NULL,
    "currencyCode" CHAR(3) NOT NULL DEFAULT 'THB',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "turnaroundMinutes" INTEGER NOT NULL DEFAULT 60,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "car_model_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "car_movements" (
    "id" TEXT NOT NULL,
    "carId" TEXT NOT NULL,
    "fromLocationId" TEXT,
    "toLocationId" TEXT NOT NULL,
    "bookingId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,

    CONSTRAINT "car_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "car_models_brand_model_idx" ON "car_models"("brand", "model");

-- CreateIndex
CREATE INDEX "car_model_locations_locationId_isActive_carModelId_idx" ON "car_model_locations"("locationId", "isActive", "carModelId");

-- CreateIndex
CREATE UNIQUE INDEX "car_movements_bookingId_key" ON "car_movements"("bookingId");

-- CreateIndex
CREATE INDEX "car_movements_carId_occurredAt_idx" ON "car_movements"("carId", "occurredAt");

-- CreateIndex
CREATE INDEX "cars_carModelLocationId_isAvailable_idx" ON "cars"("carModelLocationId", "isAvailable");

-- AddForeignKey
ALTER TABLE "car_model_locations" ADD CONSTRAINT "car_model_locations_carModelId_fkey" FOREIGN KEY ("carModelId") REFERENCES "car_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "car_model_locations" ADD CONSTRAINT "car_model_locations_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cars" ADD CONSTRAINT "cars_carModelLocationId_fkey" FOREIGN KEY ("carModelLocationId") REFERENCES "car_model_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_carModelLocationId_fkey" FOREIGN KEY ("carModelLocationId") REFERENCES "car_model_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "car_movements" ADD CONSTRAINT "car_movements_carId_fkey" FOREIGN KEY ("carId") REFERENCES "cars"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "car_movements" ADD CONSTRAINT "car_movements_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "car_movements" ADD CONSTRAINT "car_movements_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "car_movements" ADD CONSTRAINT "car_movements_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill using every advertised specification. Never merge by the model name alone.
CREATE TEMP TABLE fleet_model_map ON COMMIT DROP AS SELECT id AS car_id, 'model-' || md5(jsonb_build_array("brand", "model", "year", "seats", "transmission", "fuelType", "imageUrl", "options", "featureCodes", "categories", "categoryLabel", "steeringSide", "transmissionType", "luggageCapacity", "description", "rating", "reviewCount", "badge", "isFeatured", "recommendationOrder")::text) AS model_id FROM cars;
INSERT INTO car_models (id, "brand", "model", "year", "seats", "transmission", "fuelType", "imageUrl", "options", "featureCodes", "categories", "categoryLabel", "steeringSide", "transmissionType", "luggageCapacity", "description", "rating", "reviewCount", "badge", "isFeatured", "recommendationOrder", "createdAt", "updatedAt") SELECT DISTINCT ON (m.model_id) m.model_id, c."brand", c."model", c."year", c."seats", c."transmission", c."fuelType", c."imageUrl", c."options", c."featureCodes", c."categories", c."categoryLabel", c."steeringSide", c."transmissionType", c."luggageCapacity", c."description", c."rating", c."reviewCount", c."badge", c."isFeatured", c."recommendationOrder", c."createdAt", c."updatedAt" FROM cars c JOIN fleet_model_map m ON m.car_id = c.id ORDER BY m.model_id, c.id;
CREATE TEMP TABLE fleet_offer_map ON COMMIT DROP AS SELECT c.id AS car_id, m.model_id, 'offer-' || md5(jsonb_build_array(m.model_id, c."locationId", COALESCE(NULLIF(c."providerName", ''), 'FUNCH Rental'), c."hourlyRate", c."dailyRate", c."currencyCode")::text) AS offer_id FROM cars c JOIN fleet_model_map m ON m.car_id = c.id WHERE c."locationId" IS NOT NULL;
INSERT INTO car_model_locations (id, "carModelId", "locationId", "providerName", "hourlyRate", "dailyRate", "currencyCode", "turnaroundMinutes", "createdAt", "updatedAt") SELECT DISTINCT ON (m.offer_id) m.offer_id, m.model_id, c."locationId", COALESCE(NULLIF(c."providerName", ''), 'FUNCH Rental'), c."hourlyRate", c."dailyRate", c."currencyCode", 0, c."createdAt", c."updatedAt" FROM cars c JOIN fleet_offer_map m ON m.car_id = c.id ORDER BY m.offer_id, c.id;
UPDATE cars c SET "carModelLocationId" = m.offer_id FROM fleet_offer_map m WHERE m.car_id = c.id;
UPDATE bookings b SET "carModelLocationId" = c."carModelLocationId", "carSnapshot" = jsonb_build_object('brand', c.brand, 'model', c.model, 'year', c.year, 'licensePlate', c."licensePlate", 'pickupLocationId', b."pickupLocationId", 'dropoffLocationId', b."dropoffLocationId") FROM cars c WHERE b."carId" = c.id;

COMMIT;
