-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "DrivingSide" AS ENUM ('LEFT', 'RIGHT');

-- CreateEnum
CREATE TYPE "SteeringSide" AS ENUM ('RHD', 'LHD');

-- CreateEnum
CREATE TYPE "CarCategory" AS ENUM ('SUV', 'SEDAN', 'MPV', 'EV', 'ECO', 'LUXURY', 'WAGON');

-- CreateEnum
CREATE TYPE "TransmissionType" AS ENUM ('AUTOMATIC', 'MANUAL');

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('EXISTING_MEMBER', 'REGISTER_AND_BOOK');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('AVAILABLE', 'CLEANING', 'MAINTENANCE', 'INACTIVE');

-- CreateTable
CREATE TABLE "countries" (
    "code" CHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "nameTh" TEXT NOT NULL,
    "flag" TEXT NOT NULL,
    "currencyCode" CHAR(3) NOT NULL,
    "drivingSide" "DrivingSide" NOT NULL,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameTh" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "cityTh" TEXT NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "timeZone" TEXT NOT NULL,
    "airportCode" CHAR(3),

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cars" (
    "id" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "licensePlate" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "hourlyRate" DECIMAL(12,2) NOT NULL,
    "dailyRate" DECIMAL(12,2) NOT NULL,
    "currencyCode" CHAR(3) NOT NULL DEFAULT 'THB',
    "seats" INTEGER NOT NULL DEFAULT 4,
    "transmission" TEXT NOT NULL DEFAULT 'Automatic',
    "fuelType" TEXT NOT NULL DEFAULT 'Gasoline',
    "options" JSONB,
    "featureCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "categories" "CarCategory"[] DEFAULT ARRAY[]::"CarCategory"[],
    "categoryLabel" TEXT,
    "steeringSide" "SteeringSide" NOT NULL DEFAULT 'RHD',
    "transmissionType" "TransmissionType" NOT NULL DEFAULT 'AUTOMATIC',
    "luggageCapacity" INTEGER NOT NULL DEFAULT 2,
    "description" TEXT,
    "providerName" TEXT,
    "locationId" TEXT,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "badge" TEXT,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "recommendationOrder" INTEGER NOT NULL DEFAULT 100,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "carModelLocationId" TEXT,
    "availableFrom" TIMESTAMP(3),
    "operationalStatus" "VehicleStatus" NOT NULL DEFAULT 'AVAILABLE',
    "exteriorColor" TEXT,
    "odometerKm" INTEGER,
    "vin" TEXT,

    CONSTRAINT "cars_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cars_odometer_nonnegative" CHECK ("odometerKm" IS NULL OR "odometerKm" >= 0)
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "bookingNumber" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "carId" TEXT NOT NULL,
    "startDateTime" TIMESTAMP(3) NOT NULL,
    "endDateTime" TIMESTAMP(3) NOT NULL,
    "calculatedDays" INTEGER NOT NULL DEFAULT 0,
    "calculatedHours" INTEGER NOT NULL DEFAULT 0,
    "totalPrice" DECIMAL(12,2) NOT NULL,
    "pricingDetails" JSONB,
    "hourlyRate" DECIMAL(12,2),
    "dailyRate" DECIMAL(12,2),
    "currencyCode" CHAR(3) NOT NULL DEFAULT 'THB',
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "driverName" TEXT,
    "internationalDrivingPermit" TEXT,
    "pickupLocationId" TEXT,
    "dropoffLocationId" TEXT,
    "source" "BookingSource" NOT NULL DEFAULT 'EXISTING_MEMBER',
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "adminNote" TEXT,
    "approvedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "carModelLocationId" TEXT,
    "carSnapshot" JSONB,
    "turnaroundMinutes" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

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
    "note" TEXT,

    CONSTRAINT "car_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "locations_countryCode_city_idx" ON "locations"("countryCode", "city");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "cars_country_isAvailable_locationId_idx" ON "cars"("country", "isAvailable", "locationId");

-- CreateIndex
CREATE INDEX "cars_categories_idx" ON "cars" USING GIN ("categories");

-- CreateIndex
CREATE INDEX "cars_featureCodes_idx" ON "cars" USING GIN ("featureCodes");

-- CreateIndex
CREATE UNIQUE INDEX "cars_country_licensePlate_key" ON "cars"("country", "licensePlate");

-- CreateIndex
CREATE INDEX "cars_carModelLocationId_isAvailable_idx" ON "cars"("carModelLocationId", "isAvailable");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_bookingNumber_key" ON "bookings"("bookingNumber");

-- CreateIndex
CREATE INDEX "bookings_carId_status_startDateTime_endDateTime_idx" ON "bookings"("carId", "status", "startDateTime", "endDateTime");

-- CreateIndex
CREATE INDEX "bookings_status_createdAt_idx" ON "bookings"("status", "createdAt");

-- CreateIndex
CREATE INDEX "bookings_userId_createdAt_idx" ON "bookings"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "car_models_brand_model_idx" ON "car_models"("brand", "model");

-- CreateIndex
CREATE INDEX "car_model_locations_locationId_isActive_carModelId_idx" ON "car_model_locations"("locationId", "isActive", "carModelId");

-- CreateIndex
CREATE UNIQUE INDEX "car_movements_bookingId_key" ON "car_movements"("bookingId");

-- CreateIndex
CREATE INDEX "car_movements_carId_occurredAt_idx" ON "car_movements"("carId", "occurredAt");

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cars" ADD CONSTRAINT "cars_country_fkey" FOREIGN KEY ("country") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cars" ADD CONSTRAINT "cars_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cars" ADD CONSTRAINT "cars_carModelLocationId_fkey" FOREIGN KEY ("carModelLocationId") REFERENCES "car_model_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_carId_fkey" FOREIGN KEY ("carId") REFERENCES "cars"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_pickupLocationId_fkey" FOREIGN KEY ("pickupLocationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_dropoffLocationId_fkey" FOREIGN KEY ("dropoffLocationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_carModelLocationId_fkey" FOREIGN KEY ("carModelLocationId") REFERENCES "car_model_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "car_model_locations" ADD CONSTRAINT "car_model_locations_carModelId_fkey" FOREIGN KEY ("carModelId") REFERENCES "car_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "car_model_locations" ADD CONSTRAINT "car_model_locations_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "car_movements" ADD CONSTRAINT "car_movements_carId_fkey" FOREIGN KEY ("carId") REFERENCES "cars"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "car_movements" ADD CONSTRAINT "car_movements_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "car_movements" ADD CONSTRAINT "car_movements_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "car_movements" ADD CONSTRAINT "car_movements_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
