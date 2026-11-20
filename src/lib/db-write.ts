import { randomUUID } from "node:crypto";
import { queryRows, type Database } from "./db.js";
import { modelFields } from "./car-inventory.js";

const tableColumns = {
  car_models: [...modelFields, "imageUrl"],
  car_model_locations: [
    "carModelId", "locationId", "providerName", "hourlyRate", "dailyRate",
    "currencyCode", "isActive", "turnaroundMinutes",
  ],
  cars: [
    ...modelFields, "licensePlate", "country", "hourlyRate", "dailyRate",
    "currencyCode", "providerName", "locationId", "carModelLocationId",
    "isAvailable", "operationalStatus", "exteriorColor", "odometerKm", "vin", "availableFrom", "createdAt",
  ],
  bookings: [
    "bookingNumber", "userId", "carId", "carModelLocationId", "carSnapshot",
    "turnaroundMinutes", "startDateTime", "endDateTime", "calculatedDays",
    "calculatedHours", "totalPrice", "pricingDetails", "hourlyRate", "dailyRate",
    "currencyCode", "timeZone", "driverName", "internationalDrivingPermit",
    "pickupLocationId", "dropoffLocationId", "source", "status", "adminNote",
    "approvedById", "reviewedAt", "createdAt",
  ],
  car_movements: ["carId", "fromLocationId", "toLocationId", "bookingId", "reason", "note"],
} as const;
type Table = keyof typeof tableColumns;
type Values = Record<string, unknown>;
const jsonColumns = new Set(["options", "carSnapshot", "pricingDetails"]);
const quote = (column: string) => '"' + column + '"';

function columnValue(column: string, value: unknown) {
  return jsonColumns.has(column) && value != null ? JSON.stringify(value) : value;
}

function writeInsert(
  db: Database,
  table: Table,
  rows: Values[],
  insertOnlyColumns?: readonly string[],
) {
  const supplied = new Set(rows.flatMap(Object.keys));
  const columns = tableColumns[table].filter((column) => supplied.has(column));
  const names = ["id", ...columns, ...(table === "car_movements" ? [] : ["updatedAt"])];
  const values: unknown[] = [];
  const now = new Date();
  const tuples = rows.map((row) => {
    const parameters = names.map((column) => {
      const value = column === "id" ? row.id ?? randomUUID() :
        column === "updatedAt" ? now : columnValue(column, row[column]);
      if (value === undefined) return "DEFAULT";
      values.push(value);
      return "$" + values.length;
    });
    return "(" + parameters.join(", ") + ")";
  });
  // A supplied list enables an ID upsert and protects the listed fields on existing rows.
  const conflict = insertOnlyColumns === undefined ? "" :
    ' ON CONFLICT (id) DO UPDATE SET ' + names
      .filter((name) => name !== "id" && !insertOnlyColumns.includes(name))
      .map((name) => name === "updatedAt"
        ? quote(name) + ' = GREATEST(EXCLUDED."updatedAt", ' + table + '."updatedAt" + interval \'1 millisecond\')'
        : quote(name) + " = EXCLUDED." + quote(name))
      .join(", ");
  return queryRows<{ id: string }>(
    db,
    "INSERT INTO " + table + " (" + names.map(quote).join(", ") +
      ") VALUES " + tuples.join(", ") + conflict + " RETURNING id",
    values,
  );
}

export function insertRows(db: Database, table: Table, rows: Values[]) {
  return writeInsert(db, table, rows);
}

type SeedRow = Values & { id: string };

export function upsertSeedCars(db: Database, rows: SeedRow[]) {
  return writeInsert(db, "cars", rows, ["exteriorColor", "vin", "odometerKm"]);
}

export function upsertSeedBookings(db: Database, rows: SeedRow[]) {
  return writeInsert(db, "bookings", rows, []);
}

export function updateRows(
  db: Database,
  table: Exclude<Table, "car_movements">,
  values: Values,
  filter: { id: string } | { offerId: string } | { modelId: string },
) {
  const where = "id" in filter ? "id = $1" :
    "offerId" in filter ? '"carModelLocationId" = $1' :
      '"carModelLocationId" IN (SELECT id FROM car_model_locations WHERE "carModelId" = $1)';
  const id = "id" in filter ? filter.id : "offerId" in filter ? filter.offerId : filter.modelId;
  const columns = [...tableColumns[table].filter((column) => values[column] !== undefined), "updatedAt"];
  const assignments = columns.map((column, index) => {
    const parameter = "$" + (index + 2);
    // Cars and bookings use updatedAt as an optimistic version at millisecond precision.
    if (column === "updatedAt" && (table === "cars" || table === "bookings")) {
      return '"updatedAt" = GREATEST(' + parameter + '::timestamp, "updatedAt" + interval \'1 millisecond\')';
    }
    return quote(column) + " = " + parameter;
  });
  return queryRows<{ id: string }>(
    db,
    "UPDATE " + table + " SET " + assignments.join(", ") + " WHERE " + where + " RETURNING id",
    [id, ...columns.map((column) =>
      column === "updatedAt" ? new Date() : columnValue(column, values[column]))],
  );
}
