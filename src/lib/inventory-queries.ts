import type { PoolClient } from "pg";
import { queryOne, queryRows, type Database } from "./db.js";
import { inventoryLockKey, modelData, reservedStatuses, type ScheduledRental } from "./car-inventory.js";
import type { BookingStatus, VehicleStatus } from "./db-types.js";
import { insertRows, updateRows } from "./db-write.js";

export type Country = {
  code: string; name: string; nameTh: string; flag: string;
  currencyCode: string; drivingSide: "LEFT" | "RIGHT";
};
export type Location = {
  id: string; name: string; nameTh: string; city: string; cityTh: string;
  countryCode: string; timeZone: string; airportCode: string | null;
};
export type Specification = {
  brand: string; model: string; year: number; seats: number; transmission: string;
  fuelType: string; options: unknown; featureCodes: string[]; categories: string[];
  categoryLabel: string | null; steeringSide: string; transmissionType: string;
  luggageCapacity: number; description: string | null; rating: number;
  reviewCount: number; badge: string | null; isFeatured: boolean; recommendationOrder: number;
};
export type CarModel = Specification & {
  id: string; imageUrl: string | null; createdAt: Date | string; updatedAt: Date | string;
};
export type Offer = {
  id: string; carModelId: string; locationId: string; providerName: string;
  hourlyRate: string; dailyRate: string; currencyCode: string;
  isActive: boolean; turnaroundMinutes: number; createdAt: Date | string; updatedAt: Date | string;
};
export type FullOffer = Offer & {
  carModel: CarModel; location: Location & { country: Country };
};
export type Car = Specification & {
  id: string; licensePlate: string; country: string; locationId: string | null;
  carModelLocationId: string | null; hourlyRate: string; dailyRate: string; currencyCode: string;
  providerName: string | null; isAvailable: boolean; operationalStatus: VehicleStatus;
  exteriorColor: string | null; odometerKm: number | null; vin: string | null;
  availableFrom: Date | null; createdAt: Date; updatedAt: Date;
};
export type CarWithLocation = Car & { location: Location | null; countryInfo: Country };
export type InventoryCar = CarWithLocation & { carModelLocation: FullOffer | null };
type Reservation = ScheduledRental & { status: BookingStatus };

const carColumns = 'c.*, c.categories::text[] AS categories';
const modelColumns = 'm.*, m.categories::text[] AS categories';

// Relation objects retain the API's decimal strings and UTC timestamps.
const isoDate = (column: string) => 'to_char(' + column + ', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\')';
function datedJson(alias: "m" | "o" | "c") {
  return "to_jsonb(" + alias + ") || jsonb_build_object(" +
    "'createdAt', " + isoDate(alias + '."createdAt"') + ", 'updatedAt', " +
    isoDate(alias + '."updatedAt"') + ")";
}
function ratesJson(alias: "o" | "c") {
  return "jsonb_build_object('hourlyRate', trim_scale(" + alias + '."hourlyRate")::text, ' +
    "'dailyRate', trim_scale(" + alias + '."dailyRate")::text)';
}
export const carJson = "(" + datedJson("c") + " || " + ratesJson("c") +
  " || jsonb_build_object('availableFrom', " + isoDate('c."availableFrom"') + "))";
const offerJson = "(" + datedJson("o") + " || " + ratesJson("o") +
  " || jsonb_build_object('carModel', " + datedJson("m") +
  ", 'location', to_jsonb(branch) || jsonb_build_object('country', to_jsonb(offer_country))))";
const offerRelations = `
  JOIN car_models m ON m.id = o."carModelId"
  JOIN locations branch ON branch.id = o."locationId"
  JOIN countries offer_country ON offer_country.code = branch."countryCode"`;
const inventoryColumns = carColumns + `,
  to_jsonb(l) AS location, to_jsonb(co) AS "countryInfo",
  (SELECT ${offerJson} FROM car_model_locations o ${offerRelations}
    WHERE o.id = c."carModelLocationId") AS "carModelLocation"`;
const carLocations = `
  LEFT JOIN locations l ON l.id = c."locationId"
  JOIN countries co ON co.code = c.country`;
const offerColumns = `o.*, ${datedJson("m")} AS "carModel",
  to_jsonb(branch) || jsonb_build_object('country', to_jsonb(offer_country)) AS location`;

export function lockCarInventory(tx: PoolClient) {
  return tx.query("SELECT pg_advisory_xact_lock($1::bigint)", [inventoryLockKey]);
}

export function lockCar(tx: PoolClient, id: string) {
  return tx.query("SELECT id FROM cars WHERE id = $1 FOR UPDATE", [id]);
}

export function findLocation(db: Database, id: string) {
  return queryOne<Location>(db, "SELECT * FROM locations WHERE id = $1", [id]);
}

export function findCar(db: Database, id: string) {
  return queryOne<InventoryCar>(
    db, 'SELECT ' + inventoryColumns + ' FROM cars c ' + carLocations + ' WHERE c.id = $1', [id],
  );
}

export function carsByIds(db: Database, ids: string[]) {
  return queryRows<InventoryCar>(
    db, "SELECT " + inventoryColumns + " FROM cars c " + carLocations +
      " WHERE c.id = ANY($1::text[])", [ids],
  );
}

export function publicCar(db: Database, id: string) {
  return queryOne<CarWithLocation>(
    db, 'SELECT ' + carColumns + ', to_jsonb(l) AS location, to_jsonb(co) AS "countryInfo"' +
      ' FROM cars c ' + carLocations + ' WHERE c.id = $1', [id],
  );
}

export function listPublicCars(db: Database, filters: {
  country: string | null; available: boolean | null; category: string | null; locationId: string | null;
}) {
  return queryRows<CarWithLocation>(
    db,
    'SELECT ' + carColumns + ', to_jsonb(l) AS location, to_jsonb(co) AS "countryInfo"' +
      ' FROM cars c ' + carLocations + `
      WHERE ($1::text IS NULL OR c.country = $1)
        AND ($2::boolean IS NULL OR c."isAvailable" = $2)
        AND ($3::text IS NULL OR $3 = ANY(c.categories::text[]) OR c."categoryLabel" ILIKE $4)
        AND ($5::text IS NULL OR c."locationId" = $5)
      ORDER BY c."isFeatured" DESC, c."recommendationOrder", c."createdAt" DESC`,
    [filters.country, filters.available, filters.category?.toUpperCase() ?? null,
      filters.category === null ? null : "%" + filters.category + "%", filters.locationId],
  );
}

export function findModel(db: Database, id: string) {
  return queryOne<CarModel>(db, "SELECT " + modelColumns + " FROM car_models m WHERE m.id = $1", [id]);
}

export function listModels(db: Database) {
  return queryRows<CarModel>(db, "SELECT " + modelColumns + " FROM car_models m ORDER BY m.brand, m.model");
}

export function findOffer(db: Database, id: string) {
  return queryOne<FullOffer>(
    db, "SELECT " + offerColumns + " FROM car_model_locations o " + offerRelations + " WHERE o.id = $1", [id],
  );
}

export function branchOffer(
  db: Database,
  modelId: string,
  locationId: string,
  provider: string | null,
  { activeOnly = true } = {},
) {
  return queryOne<FullOffer>(
    db, "SELECT " + offerColumns + " FROM car_model_locations o " + offerRelations +
      ' WHERE o."carModelId" = $1 AND o."locationId" = $2 AND o."providerName" = $3' +
      ' AND (NOT $4::boolean OR o."isActive") ORDER BY o.id LIMIT 1',
    [modelId, locationId, provider, activeOnly],
  );
}

export function searchOffers(db: Database, locationId: string | null, country: string | null) {
  return queryRows<FullOffer>(
    db, "SELECT " + offerColumns + " FROM car_model_locations o " + offerRelations + `
      WHERE o."isActive" AND ($1::text IS NULL OR o."locationId" = $1)
        AND ($2::text IS NULL OR branch."countryCode"::text = $2)
      ORDER BY m."isFeatured" DESC, m."recommendationOrder", o.id`, [locationId, country],
  );
}

export function destinationOffers(db: Database, locationId: string) {
  return queryRows<Pick<Offer, "carModelId" | "providerName">>(
    db, 'SELECT "carModelId", "providerName" FROM car_model_locations WHERE "locationId" = $1 AND "isActive"',
    [locationId],
  );
}

export function catalogOffers(db: Database) {
  return queryRows<FullOffer & { _count: { cars: number } }>(
    db, "SELECT " + offerColumns + `,
      jsonb_build_object('cars', (SELECT count(*) FROM cars WHERE "carModelLocationId" = o.id)) AS _count
      FROM car_model_locations o ` + offerRelations + ' ORDER BY o."createdAt"',
  );
}

export function reservations(db: Database, carId: string, excludedId: string | null = null) {
  return queryRows<Reservation>(
    db, `SELECT id, status, "startDateTime", "endDateTime", "pickupLocationId", "dropoffLocationId",
      "turnaroundMinutes" FROM bookings WHERE "carId" = $1 AND status = ANY($2::"BookingStatus"[])
      AND ($3::text IS NULL OR id <> $3) ORDER BY "startDateTime"`,
    [carId, reservedStatuses, excludedId],
  );
}

export function hasReservations(db: Database, carId: string, endAfter: Date | null = null) {
  return queryOne<{ id: string }>(
    db, `SELECT id FROM bookings WHERE "carId" = $1 AND status = ANY($2::"BookingStatus"[])
      AND ($3::timestamp IS NULL OR "endDateTime" > $3) LIMIT 1`,
    [carId, reservedStatuses, endAfter],
  );
}

export async function listInventory(db: Database, availableOnly = false) {
  const cars = await queryRows<InventoryCar>(
    db, "SELECT " + inventoryColumns + " FROM cars c " + carLocations + `
      WHERE (NOT $1::boolean OR (c."isAvailable" AND c."operationalStatus" = 'AVAILABLE'
        AND c."carModelLocationId" IS NOT NULL))
      ORDER BY c."createdAt" DESC, c.id`, [availableOnly],
  );
  const bookings = await queryRows<Reservation & { carId: string }>(
    db, `SELECT "carId", status, "startDateTime", "endDateTime", "pickupLocationId",
      "dropoffLocationId", "turnaroundMinutes" FROM bookings
      WHERE status = ANY($1::"BookingStatus"[]) AND "carId" = ANY($2::text[])`,
    [reservedStatuses, cars.map((car) => car.id)],
  );
  const byCar = new Map<string, Reservation[]>();
  for (const booking of bookings) {
    const group = byCar.get(booking.carId) ?? [];
    group.push(booking);
    byCar.set(booking.carId, group);
  }
  return cars.map((car) => ({ ...car, bookings: byCar.get(car.id) ?? [] }));
}

export function candidateCars(db: Database, offer: FullOffer) {
  return queryRows<InventoryCar>(
    db, "SELECT " + inventoryColumns + " FROM cars c " + carLocations + `
      JOIN car_model_locations home ON home.id = c."carModelLocationId"
      WHERE c."isAvailable" AND c."operationalStatus" = 'AVAILABLE' AND c.country = $1
        AND home."carModelId" = $2 AND home."providerName" = $3 ORDER BY c.id`,
    [offer.location.countryCode, offer.carModelId, offer.providerName],
  );
}

export async function attachLegacyCar(db: Database, car: Car, imageUrl: string | null = null) {
  if (!car.locationId) return;
  const specification = { ...modelData(car), imageUrl };
  const model = await queryOne<{ id: string }>(
    db, `SELECT m.id FROM car_models m
      WHERE to_jsonb(m) - ARRAY['id', 'createdAt', 'updatedAt'] = $1::jsonb
        AND m.options IS NOT DISTINCT FROM $2::jsonb LIMIT 1`,
    [specification, car.options === null ? null : JSON.stringify(car.options)],
  );
  const carModelId = (model ?? (await insertRows(db, "car_models", [specification]))[0]).id;
  const providerName = car.providerName || "FUNCH Rental";
  const offer = await queryOne<{ id: string }>(
    db, `SELECT id FROM car_model_locations WHERE "carModelId" = $1 AND "locationId" = $2
      AND "providerName" = $3 AND "hourlyRate" = $4 AND "dailyRate" = $5 AND "currencyCode" = $6 LIMIT 1`,
    [carModelId, car.locationId, providerName, car.hourlyRate, car.dailyRate, car.currencyCode],
  );
  const offerId = (offer ?? (await insertRows(db, "car_model_locations", [{
    carModelId, locationId: car.locationId, providerName, hourlyRate: car.hourlyRate,
    dailyRate: car.dailyRate, currencyCode: car.currencyCode, turnaroundMinutes: 0,
  }]))[0]).id;
  await updateRows(db, "cars", { carModelLocationId: offerId }, { id: car.id });
}

export async function carSchedule(db: Database, id: string) {
  const car = await queryOne<Car & { location: Location | null }>(
    db, "SELECT " + carColumns + ', to_jsonb(l) AS location FROM cars c' +
      ' LEFT JOIN locations l ON l.id = c."locationId" WHERE c.id = $1', [id],
  );
  if (!car) return null;
  const movements = await queryRows(db, `
    SELECT m.*, to_jsonb(f) AS "fromLocation", to_jsonb(t) AS "toLocation"
    FROM car_movements m LEFT JOIN locations f ON f.id = m."fromLocationId"
    JOIN locations t ON t.id = m."toLocationId"
    WHERE m."carId" = $1 ORDER BY m."occurredAt" DESC`, [id]);
  const bookings = await queryRows(db, `
    SELECT b.id, b."bookingNumber", b.status, b."startDateTime", b."endDateTime",
      b."turnaroundMinutes", to_jsonb(p) AS "pickupLocation", to_jsonb(d) AS "dropoffLocation"
    FROM bookings b LEFT JOIN locations p ON p.id = b."pickupLocationId"
    LEFT JOIN locations d ON d.id = b."dropoffLocationId"
    WHERE b."carId" = $1 ORDER BY b."startDateTime"`, [id]);
  return { ...car, movements, bookings };
}
