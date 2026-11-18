import { Prisma } from '@prisma/client';
import { bookings, cars, demoVehicleDetails, locations } from './seed-data.js';
import { legacyValues, lockFleet, offerInclude, type FleetTx } from '../src/lib/fleet.js';

// Two more registrations at the original branch, plus two at another branch in the same country.
// Stable IDs and create-only writes preserve edited vehicles, transfers and bookings on reruns.
export const fleetExpansionPlan = cars.flatMap((source, index) => {
  const home = locations.find((location) => location.id === source.locationId)!;
  const alternatives = locations.filter((location) => location.countryCode === home.countryCode && location.id !== home.id);
  const destinations = new Set<string>([home.id]);
  if (alternatives.length) destinations.add(alternatives[index % alternatives.length].id);
  for (const booking of bookings.filter((booking) => booking.carId === source.id)) {
    if (booking.dropoffLocationId) destinations.add(booking.dropoffLocationId);
  }
  return [...destinations].map((locationId, branchIndex) => ({
    sourceId: source.id!, locationId,
    units: [1, 2].map((unit) => {
      const id = `${source.id}-fleet-${branchIndex + 1}-${unit}`;
      return { id, licensePlate: `${source.licensePlate}-F${branchIndex + 1}-${unit}`, ...demoVehicleDetails(id) };
    }),
  }));
});

export async function fillMissingDemoVehicleDetails(tx: FleetTx) {
  await lockFleet(tx);
  const vehicles = [...cars, ...fleetExpansionPlan.flatMap(({ units }) => units)];
  const details = vehicles.map(({ id, exteriorColor, vin, odometerKm }) =>
    Prisma.sql`(${id}, ${exteriorColor}, ${vin}, ${odometerKm}::integer)`);
  return tx.$executeRaw`
    UPDATE "cars" AS car
    SET "exteriorColor" = COALESCE(car."exteriorColor", seed."exteriorColor"),
        "vin" = COALESCE(car."vin", seed."vin"),
        "odometerKm" = COALESCE(car."odometerKm", seed."odometerKm"),
        "updatedAt" = CURRENT_TIMESTAMP
    FROM (VALUES ${Prisma.join(details)}) AS seed("id", "exteriorColor", "vin", "odometerKm")
    WHERE car."id" = seed."id"
      AND (car."exteriorColor" IS NULL OR car."vin" IS NULL OR car."odometerKm" IS NULL)
  `;
}

export async function expandDemoFleet(tx: FleetTx) {
  await lockFleet(tx);
  let createdCars = 0, createdOffers = 0;
  for (const group of fleetExpansionPlan) {
    const source = await tx.car.findUnique({ where: { id: group.sourceId }, include: { carModelLocation: { include: offerInclude } } });
    if (!source?.carModelLocation) throw new Error(`Demo source is missing or has no model: ${group.sourceId}`);
    const home = source.carModelLocation;
    const location = await tx.location.findUniqueOrThrow({ where: { id: group.locationId } });
    if (location.countryCode !== source.country) throw new Error('Demo expansion cannot move vehicles across countries');
    let offer = await tx.carModelLocation.findFirst({ where: {
      carModelId: home.carModelId, locationId: location.id, providerName: home.providerName,
    }, include: offerInclude, orderBy: { id: 'asc' } });
    if (!offer) {
      offer = await tx.carModelLocation.create({ data: {
        id: `seed-offer-${group.sourceId}-${location.id}`, carModelId: home.carModelId,
        locationId: location.id, providerName: home.providerName,
        hourlyRate: home.hourlyRate, dailyRate: home.dailyRate, currencyCode: home.currencyCode,
      }, include: offerInclude });
      createdOffers++;
    }
    const existing = await tx.car.findMany({ where: { id: { in: group.units.map((unit) => unit.id) } }, select: { id: true } });
    const ids = new Set(existing.map((car) => car.id));
    const rows = group.units.filter((unit) => !ids.has(unit.id)).map((unit) => ({
      ...legacyValues(offer), ...unit, carModelLocationId: offer!.id, locationId: offer!.locationId,
      isAvailable: source.isAvailable,
      operationalStatus: source.isAvailable ? 'AVAILABLE' : 'INACTIVE',
    } as Prisma.CarCreateManyInput));
    if (rows.length) createdCars += (await tx.car.createMany({ data: rows })).count;
  }
  return { createdCars, createdOffers };
}
