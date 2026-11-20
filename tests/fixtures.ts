import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import { databasePool, queryOne, queryRows, required, type Database } from "../src/lib/db.js";
import type { BookingStatus } from "../src/lib/db-types.js";
import { insertRows } from "../src/lib/db-write.js";
import { findCar } from "../src/lib/inventory-queries.js";
import { createUser } from "../src/lib/users.js";

export const rows = (sql: string, values?: unknown[]) => queryRows(databasePool(), sql, values);
export async function row<Row extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]) {
  return required(await queryOne<Row>(databasePool(), sql, values));
}
export async function count(sql: string, values: unknown[]) {
  return Number((await row(sql, values)).count);
}
export const execute = (sql: string, values: unknown[], db: Database = databasePool()) =>
  queryRows(db, sql, values);

export const fixtureUser = createUser;

export async function fixtureCar(data: Record<string, unknown>) {
  const [car] = await insertRows(databasePool(), "cars", [data]);
  return row("SELECT *, categories::text[] AS categories FROM cars WHERE id = $1", [car.id]);
}

export async function fixtureBooking(data: Record<string, unknown>) {
  const [booking] = await insertRows(databasePool(), "bookings", [
    { bookingNumber: randomUUID(), ...data },
  ]);
  return row<{
    id: string; bookingNumber: string; status: BookingStatus; updatedAt: Date;
    totalPrice: string; carSnapshot: unknown;
  }>("SELECT * FROM bookings WHERE id = $1", [booking.id]);
}

export async function fixtureLocation(data: {
  name: string; nameTh: string; city: string; cityTh: string; countryCode: string; timeZone: string;
}) {
  return row(
    'INSERT INTO locations (id, name, "nameTh", city, "cityTh", "countryCode", "timeZone")' +
      " VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
    [randomUUID(), data.name, data.nameTh, data.city, data.cityTh, data.countryCode, data.timeZone],
  );
}

export async function inventoryCar(id: string) {
  const car = await findCar(databasePool(), id);
  assert.ok(car?.carModelLocation);
  return { ...car, carModelLocation: car.carModelLocation };
}
