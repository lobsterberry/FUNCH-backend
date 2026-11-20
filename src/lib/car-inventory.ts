export const reservedStatuses = ["PENDING", "APPROVED"] as const;

export const inventoryLockKey = 64172839;

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
