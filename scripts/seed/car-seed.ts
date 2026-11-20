import type { PoolClient } from "pg";
import { queryRows, required } from "../../src/lib/db.js";
import { insertRows } from "../../src/lib/db-write.js";
import { bookings, cars, demoVehicleDetails, locations } from "./seed-data.js";
import { legacyValues } from "../../src/lib/car-inventory.js";
import { branchOffer, findCar, findLocation, findOffer } from "../../src/lib/inventory-queries.js";

// Two more registrations at the original branch, plus two at another branch in the same country.
// Stable IDs and create-only writes preserve edited vehicles, transfers and bookings on reruns.
export const carExpansionPlan = cars.flatMap((source, index) => {
  const home = locations.find((location) => location.id === source.locationId)!;
  const alternatives = locations.filter(
    (location) =>
      location.countryCode === home.countryCode && location.id !== home.id,
  );
  const destinations = new Set<string>([home.id]);
  if (alternatives.length)
    destinations.add(alternatives[index % alternatives.length].id);
  for (const booking of bookings.filter(
    (booking) => booking.carId === source.id,
  )) {
    if (booking.dropoffLocationId) destinations.add(booking.dropoffLocationId);
  }
  return [...destinations].map((locationId, branchIndex) => ({
    sourceId: source.id,
    locationId,
    units: [1, 2].map((unit) => {
      // Existing installations use this ID format for seeded cars.
      const id = `${source.id}-fleet-${branchIndex + 1}-${unit}`;
      return {
        id,
        licensePlate: `${source.licensePlate}-F${branchIndex + 1}-${unit}`,
        ...demoVehicleDetails(id),
      };
    }),
  }));
});

export async function fillMissingDemoVehicleDetails(tx: PoolClient) {
  const vehicles = [
    ...cars,
    ...carExpansionPlan.flatMap(({ units }) => units),
  ];
  const result = await tx.query(`
    UPDATE "cars" AS car
    SET "exteriorColor" = COALESCE(car."exteriorColor", seed."exteriorColor"),
        "vin" = COALESCE(car."vin", seed."vin"),
        "odometerKm" = COALESCE(car."odometerKm", seed."odometerKm"),
        "updatedAt" = GREATEST(clock_timestamp() AT TIME ZONE 'UTC', car."updatedAt" + interval '1 millisecond')
    FROM unnest($1::text[], $2::text[], $3::text[], $4::integer[])
      AS seed("id", "exteriorColor", "vin", "odometerKm")
    WHERE car."id" = seed."id"
      AND (car."exteriorColor" IS NULL OR car."vin" IS NULL OR car."odometerKm" IS NULL)
  `, [
    vehicles.map(({ id }) => id),
    vehicles.map(({ exteriorColor }) => exteriorColor),
    vehicles.map(({ vin }) => vin),
    vehicles.map(({ odometerKm }) => odometerKm),
  ]);
  return result.rowCount ?? 0;
}

// Callers hold the inventory lock for the whole seed transaction.
export async function expandDemoCars(tx: PoolClient) {
  let createdCars = 0,
    createdOffers = 0;
  for (const group of carExpansionPlan) {
    const source = await findCar(tx, group.sourceId);
    if (!source?.carModelLocation)
      throw new Error(
        `Demo source is missing or has no model: ${group.sourceId}`,
      );
    const home = source.carModelLocation;
    const location = await findLocation(tx, group.locationId);
    if (!location) throw new Error(`Demo location is missing: ${group.locationId}`);
    if (location.countryCode !== source.country)
      throw new Error("Demo expansion cannot move vehicles across countries");
    let offer = await branchOffer(tx, home.carModelId, location.id, home.providerName, { activeOnly: false });
    if (!offer) {
      const [created] = await insertRows(tx, "car_model_locations", [{
        id: `seed-offer-${group.sourceId}-${location.id}`,
        carModelId: home.carModelId,
        locationId: location.id,
        providerName: home.providerName,
        hourlyRate: home.hourlyRate,
        dailyRate: home.dailyRate,
        currencyCode: home.currencyCode,
      }]);
      offer = required(await findOffer(tx, created.id));
      createdOffers++;
    }
    const existing = await queryRows<{ id: string }>(
      tx, "SELECT id FROM cars WHERE id = ANY($1::text[])", [group.units.map((unit) => unit.id)],
    );
    const ids = new Set(existing.map((car) => car.id));
    const branch = offer;
    const rows = group.units
      .filter((unit) => !ids.has(unit.id))
      .map((unit) => ({
        ...legacyValues(branch),
        ...unit,
        carModelLocationId: branch.id,
        locationId: branch.locationId,
        isAvailable: source.isAvailable,
        operationalStatus: source.isAvailable ? "AVAILABLE" : "INACTIVE",
      }));
    if (rows.length)
      createdCars += (await insertRows(tx, "cars", rows)).length;
  }
  return { createdCars, createdOffers };
}
