import { Prisma, type PrismaClient } from "@prisma/client";

export type InventoryTx = Prisma.TransactionClient;
export const offerInclude = {
  carModel: true,
  location: { include: { country: true } },
} as const;
export const inventoryInclude = {
  carModelLocation: { include: offerInclude },
  location: true,
  countryInfo: true,
} as const;
export const reservedStatuses = ["PENDING", "APPROVED"] as const;

// Keep a single lock order for offer edits, allocation, status changes and transfers.
// Inventory writes share one transaction advisory lock; searches remain lock-free.
export async function lockCarInventory(tx: InventoryTx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(64172839)`;
}

export const modelFields = [
  "brand",
  "model",
  "year",
  "seats",
  "transmission",
  "fuelType",
  "options",
  "featureCodes",
  "categories",
  "categoryLabel",
  "steeringSide",
  "transmissionType",
  "luggageCapacity",
  "description",
  "rating",
  "reviewCount",
  "badge",
  "isFeatured",
  "recommendationOrder",
] as const;

export function modelData(car: Record<string, any>) {
  return Object.fromEntries(
    modelFields
      .filter((key) => car[key] !== undefined)
      .map((key) => [key, car[key]]),
  );
}

// Compatibility bridge for old inventory clients and idempotent demo seeding.
// New clients explicitly create a model, an offer, then individual registrations.
export async function attachLegacyCar(
  tx: InventoryTx,
  car: any,
  imageUrl: string | null = null,
) {
  if (!car.locationId) return car;
  const data = { ...modelData(car), imageUrl };
  const where: any = { ...data };
  where.featureCodes = { equals: car.featureCodes };
  where.categories = { equals: car.categories };
  where.options =
    car.options == null ? { equals: Prisma.DbNull } : { equals: car.options };
  const model =
    (await tx.carModel.findFirst({ where })) ??
    (await tx.carModel.create({
      data: {
        ...data,
        options: car.options ?? Prisma.DbNull,
      } as Prisma.CarModelCreateInput,
    }));
  const offerData = {
    carModelId: model.id,
    locationId: car.locationId,
    providerName: car.providerName || "FUNCH Rental",
    hourlyRate: car.hourlyRate,
    dailyRate: car.dailyRate,
    currencyCode: car.currencyCode,
  };
  const offer =
    (await tx.carModelLocation.findFirst({ where: offerData })) ??
    (await tx.carModelLocation.create({
      data: { ...offerData, turnaroundMinutes: 0 },
    }));
  return tx.car.update({
    where: { id: car.id },
    data: { carModelLocationId: offer.id },
  });
}

export function legacyValues(offer: any) {
  return {
    ...modelData(offer.carModel),
    hourlyRate: offer.hourlyRate,
    dailyRate: offer.dailyRate,
    currencyCode: offer.currencyCode,
    providerName: offer.providerName,
    country: offer.location.countryCode,
  };
}

export type ScheduledRental = {
  id?: string;
  startDateTime: Date;
  endDateTime: Date;
  pickupLocationId: string | null;
  dropoffLocationId: string | null;
  turnaroundMinutes: number;
};

// The physical location is the anchor; pending/approved journeys project future positions.
// Verify the entire future itinerary so inserting a one-way trip cannot strand the next renter.
export function canSchedule(
  locationId: string | null,
  rentals: ScheduledRental[],
  request: ScheduledRental,
  availableFrom?: Date | null,
) {
  if (!locationId || !request.pickupLocationId || !request.dropoffLocationId)
    return false;
  // Outstanding rentals are released only by a reviewed return/cancellation.
  if (rentals.some((rental) => rental.endDateTime <= new Date())) return false;
  return validItinerary(locationId, [...rentals, request], availableFrom);
}

export function validItinerary(
  locationId: string | null,
  rentals: ScheduledRental[],
  availableFrom?: Date | null,
) {
  if (!locationId) return rentals.length === 0;
  const itinerary = [...rentals].sort(
    (a, b) => a.startDateTime.getTime() - b.startDateTime.getTime(),
  );
  let position = locationId;
  let availableAt = availableFrom?.getTime() ?? -Infinity;
  for (const rental of itinerary) {
    if (
      rental.pickupLocationId !== position ||
      rental.startDateTime.getTime() < availableAt
    )
      return false;
    position = rental.dropoffLocationId || rental.pickupLocationId;
    availableAt =
      rental.endDateTime.getTime() + rental.turnaroundMinutes * 60_000;
  }
  return true;
}

export async function candidateCars(db: InventoryTx | PrismaClient, offer: any) {
  return db.car.findMany({
    where: {
      isAvailable: true,
      operationalStatus: "AVAILABLE",
      country: offer.location.countryCode,
      carModelLocation: {
        carModelId: offer.carModelId,
        providerName: offer.providerName,
      },
    },
    include: {
      ...inventoryInclude,
      bookings: {
        where: { status: { in: [...reservedStatuses] } },
        orderBy: { startDateTime: "asc" },
      },
    },
    orderBy: { id: "asc" },
  });
}

export function effectiveCar(car: any) {
  return car.carModelLocation
    ? {
        ...car,
        ...legacyValues(car.carModelLocation),
        // A transfer changes the physical location, not the shared model specification.
        location: car.location,
        locationId: car.locationId,
      }
    : car;
}
