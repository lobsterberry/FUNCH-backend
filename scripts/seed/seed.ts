import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { closeDatabasePool, withTransaction } from "../../src/lib/db.js";
import { upsertSeedBookings, upsertSeedCars } from "../../src/lib/db-write.js";
import { attachLegacyCar, carsByIds, lockCarInventory } from "../../src/lib/inventory-queries.js";
import { hashPassword } from "../../src/utils/password.js";
import {
  bookings,
  cars,
  countries,
  featureLabels,
  locations,
  pricingExamples,
  users,
} from "./seed-data.js";
import {
  expandDemoCars,
  fillMissingDemoVehicleDetails,
  carExpansionPlan,
} from "./car-seed.js";

function validateData() {
  for (const rows of [
    countries.map((row) => row.code),
    locations.map((row) => row.id),
    cars.map((row) => row.id),
    users.map((row) => row.id),
    bookings.map((row) => row.bookingNumber),
  ]) {
    assert.equal(
      new Set(rows).size,
      rows.length,
      "Seed identifiers must be unique",
    );
  }
  const vehicles = [
    ...cars,
    ...carExpansionPlan.flatMap(({ units }) => units),
  ];
  assert.equal(
    new Set(vehicles.map(({ vin }) => vin)).size,
    vehicles.length,
    "Each demo car must have a unique VIN",
  );
  assert.equal(
    cars.filter((row) => row.isFeatured).length,
    6,
    "Home wireframe has six featured cars",
  );
  assert.equal(
    cars.filter(
      (row) => row.locationId === "seed-location-haneda" && row.isAvailable,
    ).length,
    18,
    "Search wireframe has 18 Tokyo/Haneda cars",
  );
  assert.equal(
    new Set(bookings.map((row) => row.status)).size,
    5,
    "All booking statuses must be represented",
  );
  for (const location of locations) {
    assert(countries.some((country) => country.code === location.countryCode));
    new Intl.DateTimeFormat("en", { timeZone: location.timeZone }).format(
      new Date(),
    );
  }
  for (const vehicle of cars) {
    const location = locations.find((row) => row.id === vehicle.locationId);
    assert(
      location && location.countryCode === vehicle.country,
      "Car and pickup location countries must match",
    );
    assert(Number(vehicle.hourlyRate) > 0 && Number(vehicle.dailyRate) > 0);
    assert(vehicle.currencyCode === "THB");
    assert(
      Array.isArray(vehicle.featureCodes) &&
        vehicle.featureCodes.every((code) => code in featureLabels),
    );
  }
  for (const booking of bookings) {
    const vehicle = cars.find((row) => row.id === booking.carId);
    assert(vehicle && users.some((row) => row.id === booking.userId));
    assert(new Date(booking.endDateTime) > new Date(booking.startDateTime));
    assert.equal(
      Number(booking.totalPrice),
      Number(booking.calculatedDays) * Number(booking.dailyRate) +
        Number(booking.calculatedHours) * Number(booking.hourlyRate),
    );
    const pickup = locations.find((row) => row.id === booking.pickupLocationId);
    const dropoff = locations.find(
      (row) => row.id === booking.dropoffLocationId,
    );
    assert(pickup && dropoff && pickup.countryCode === dropoff.countryCode);
    assert.equal(booking.timeZone, pickup.timeZone);
    const requiresAdmin = ["APPROVED", "REJECTED", "COMPLETED"].includes(booking.status);
    assert.equal(
      Boolean(booking.approvedById && booking.reviewedAt),
      requiresAdmin,
    );
  }
  for (const example of pricingExamples) {
    assert.equal(example.total, example.days * 2200 + example.hours * 280);
  }
}

async function main() {
  validateData();
  const summary = {
    countries: countries.length,
    locations: locations.length,
    cars:
      cars.length +
      carExpansionPlan.reduce(
        (total, group) => total + group.units.length,
        0,
      ),
    users: users.length,
    bookings: bookings.length,
  };
  if (process.argv.includes("--dry-run")) {
    console.log("Seed data validated (no database writes):", summary);
    console.table(
      pricingExamples.map(({ key, days, hours, total }) => ({
        example: key,
        days,
        hours,
        THB: total,
      })),
    );
    return;
  }

  const memberPassword = process.env.SEED_USER_PASSWORD || randomBytes(24).toString("base64url");
  assert(
    memberPassword.length >= 12,
    "SEED_USER_PASSWORD must be at least 12 characters when set for demo members",
  );
  const seededUsers = await Promise.all(users.map(async (user) => ({
    ...user,
    password: await hashPassword(user.id === "seed-user-admin" ? "FunchDemo2026!" : memberPassword),
  })));
  const firstNewMemberBooking = Math.min(...bookings
    .filter(({ userId }) => userId === "seed-user-new-member")
    .map(({ createdAt }) => createdAt.getTime()));

  try {
    const expansion = await withTransaction(
      async (tx) => {
        await lockCarInventory(tx);
        for (const country of countries) {
          await tx.query(`
            INSERT INTO countries (code, name, "nameTh", flag, "currencyCode", "drivingSide")
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, "nameTh" = EXCLUDED."nameTh",
              flag = EXCLUDED.flag, "currencyCode" = EXCLUDED."currencyCode", "drivingSide" = EXCLUDED."drivingSide"
          `, [country.code, country.name, country.nameTh, country.flag, country.currencyCode, country.drivingSide]);
        }
        for (const location of locations) {
          await tx.query(`
            INSERT INTO locations (id, name, "nameTh", city, "cityTh", "countryCode", "timeZone", "airportCode")
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, "nameTh" = EXCLUDED."nameTh",
              city = EXCLUDED.city, "cityTh" = EXCLUDED."cityTh", "countryCode" = EXCLUDED."countryCode",
              "timeZone" = EXCLUDED."timeZone", "airportCode" = EXCLUDED."airportCode"
          `, [location.id, location.name, location.nameTh, location.city, location.cityTh,
            location.countryCode, location.timeZone, location.airportCode]);
        }
        for (const user of seededUsers) {
          const createdAt = user.id === "seed-user-new-member"
            ? new Date(firstNewMemberBooking).toISOString()
            : "2026-09-01T00:00:00.000Z";
          // Only new accounts receive the seed password or the original creation date.
          await tx.query(`
            INSERT INTO users (id, email, password, name, "firstName", "lastName", "phoneNumber",
              role, "isActive", "createdAt", "updatedAt")
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, clock_timestamp() AT TIME ZONE 'UTC')
            ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name,
              "firstName" = EXCLUDED."firstName", "lastName" = EXCLUDED."lastName",
              "phoneNumber" = EXCLUDED."phoneNumber", role = EXCLUDED.role,
              "isActive" = EXCLUDED."isActive", "updatedAt" = EXCLUDED."updatedAt"
          `, [user.id, user.email, user.password, user.name, user.firstName, user.lastName,
            user.phoneNumber, user.role, user.isActive, createdAt]);
        }
        const saved = await upsertSeedCars(tx, cars.map((vehicle) => ({
          ...vehicle,
          operationalStatus: vehicle.isAvailable ? "AVAILABLE" : "INACTIVE",
        })));
        for (const car of await carsByIds(tx, saved.map(({ id }) => id))) {
          await attachLegacyCar(tx, car);
        }
        await upsertSeedBookings(tx, bookings);
        const expansion = await expandDemoCars(tx);
        const filledVehicleDetails = await fillMissingDemoVehicleDetails(tx);
        return { ...expansion, filledVehicleDetails };
      },
      { timeoutMs: 60_000 },
    );
    console.log("Seed complete:", summary, expansion);
  } finally {
    await closeDatabasePool();
  }
}

main().catch((error: unknown) => {
  console.error("Seed failed:", error);
  process.exitCode = 1;
});
