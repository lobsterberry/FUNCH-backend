import { effectiveCar } from "./car-inventory.js";

export function formatCar(car: any) {
  car = effectiveCar(car);
  const brand = car.brand || "";
  const model = car.model || "";
  const fullName =
    brand && !model.startsWith(brand) ? `${brand} ${model}` : model;
  const fuel = car.fuelType || "Gasoline";
  const color =
    fuel === "EV"
      ? "text-blue-600"
      : fuel === "Hybrid"
        ? "text-emerald-700"
        : car.categories?.includes("LUXURY")
          ? "text-slate-800"
          : "text-slate-700";

  const category = car.categoryLabel || car.categories?.[0] || "Sedan";

  const features = Array.isArray(car.options)
    ? car.options.map((opt: any) =>
        typeof opt === "string" ? opt : opt.label || opt.code,
      )
    : car.featureCodes || [];

  return {
    id: car.id,
    carModelLocationId: car.carModelLocationId,
    carModelId: car.carModelLocation?.carModelId,
    brand: car.brand,
    name: fullName,
    model: `${fullName} ${car.year || 2024}`,
    country: car.country,
    city: car.location?.cityTh || car.location?.city || "",
    category,
    badge: car.badge || car.categoryLabel || category,
    description: car.description || "",
    seats: car.seats ?? 4,
    bags: car.luggageCapacity ?? 2,
    gear: car.transmission || "Automatic",
    transmissionType: car.transmissionType,
    categories: car.categories,
    fuel,
    steering:
      car.steeringSide === "RHD" ? ("right" as const) : ("left" as const),
    day: Number(car.dailyRate),
    hour: Number(car.hourlyRate),
    hourlyRate: car.hourlyRate,
    dailyRate: car.dailyRate,
    currencyCode: car.currencyCode || "THB",
    rating: Number(car.rating) || 4.8,
    reviews: car.reviewCount || 0,
    features,
    provider: car.providerName || "FUNCH Rental",
    color,
    featured: Boolean(car.isFeatured),
    isAvailable: car.isAvailable !== false,
    operationalStatus:
      car.isAvailable === false &&
      (!car.operationalStatus || car.operationalStatus === "AVAILABLE")
        ? "INACTIVE"
        : (car.operationalStatus ?? "AVAILABLE"),
    exteriorColor: car.exteriorColor ?? null,
    odometerKm: car.odometerKm ?? null,
    vin: car.vin ?? null,
    availableFrom: car.availableFrom ?? null,
    licensePlate: car.licensePlate,
    locationId: car.locationId,
    location: car.location,
    countryInfo: car.countryInfo,
  };
}
