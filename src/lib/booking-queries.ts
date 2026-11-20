import { randomBytes } from "node:crypto";
import { queryOne, queryRows, required, type Database } from "./db.js";
import { insertRows } from "./db-write.js";
import { carJson, type Country } from "./inventory-queries.js";
import { bookingStatuses, type BookingStatus } from "./db-types.js";
import type { ScheduledRental } from "./car-inventory.js";

type Booking = ScheduledRental & {
  id: string;
  carId: string;
  userId: string;
  status: BookingStatus;
  updatedAt: Date;
};

const bookingOrder = {
  newest: 'b."createdAt" DESC',
  pickup: 'b."startDateTime" ASC',
  value: 'b."totalPrice" DESC',
};
type AdminBookingFilters = {
  status: BookingStatus | "all";
  country: string;
  search: string;
  sort: keyof typeof bookingOrder;
  page?: number;
  pageSize?: number;
};

export async function adminBookings(db: Database, input: AdminBookingFilters) {
  const values = [
    input.status === "all" ? null : input.status,
    input.country === "all" ? null : input.country,
    input.search ? "%" + input.search + "%" : null,
  ];
  const filteredBookings = `FROM bookings b
    JOIN cars c ON c.id = b."carId"
    JOIN users u ON u.id = b."userId"
    WHERE ($1::"BookingStatus" IS NULL OR b.status = $1)
      AND ($2::text IS NULL OR c.country = $2)
      AND ($3::text IS NULL OR b."bookingNumber" ILIKE $3 OR u.name ILIKE $3 OR u.email ILIKE $3
        OR u."phoneNumber" ILIKE $3 OR c.brand ILIKE $3 OR c.model ILIKE $3
        OR c."licensePlate" ILIKE $3 OR b."driverName" ILIKE $3)`;
  const { total } = required(await queryOne<{ total: number }>(
    db, "SELECT count(*)::integer AS total " + filteredBookings, values,
  ));
  const paginated = input.page !== undefined || input.pageSize !== undefined;
  const pageSize = input.pageSize ?? 10;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(input.page ?? 1, totalPages);
  const bookings = await queryRows(db, `SELECT b.*, ${carJson} AS car,
    (SELECT to_jsonb(p) FROM locations p WHERE p.id = b."pickupLocationId") AS "pickupLocation",
    (SELECT to_jsonb(d) FROM locations d WHERE d.id = b."dropoffLocationId") AS "dropoffLocation",
    jsonb_build_object('id', u.id, 'name', u.name, 'email', u.email, 'phoneNumber', u."phoneNumber") AS "user",
    (SELECT jsonb_build_object('id', a.id, 'name', a.name, 'email', a.email)
      FROM users a WHERE a.id = b."approvedById") AS "approvedBy"
    ${filteredBookings} ORDER BY ${bookingOrder[input.sort]}, b.id
    LIMIT $4 OFFSET $5`, [...values, paginated ? pageSize : null, paginated ? (page - 1) * pageSize : 0]);
  const groups = await queryRows<{ status: BookingStatus; count: number }>(
    db, 'SELECT status, count(*)::integer AS count FROM bookings GROUP BY status',
  );
  const summary = Object.fromEntries(
    bookingStatuses.map((status) => [status, groups.find((group) => group.status === status)?.count ?? 0]),
  );
  const countries = await queryRows<Pick<Country, "code" | "name" | "nameTh" | "flag">>(
    db, 'SELECT code, name, "nameTh", flag FROM countries ORDER BY name',
  );
  return {
    data: bookings,
    count: total,
    summary,
    countries,
    ...(paginated ? { pagination: { page, pageSize, total, totalPages } } : {}),
  };
}

export function bookingHistory(db: Database, userId: string) {
  return queryRows(db, `SELECT b.id, b."bookingNumber", b.status, b."createdAt",
    b."startDateTime", b."endDateTime", b."totalPrice", b."currencyCode", b."timeZone", b."carSnapshot",
    jsonb_build_object('brand', c.brand, 'model', c.model) AS car,
    CASE WHEN p.id IS NOT NULL THEN jsonb_build_object('name', p.name, 'nameTh', p."nameTh", 'timeZone', p."timeZone")
      END AS "pickupLocation",
    CASE WHEN d.id IS NOT NULL THEN jsonb_build_object('name', d.name, 'nameTh', d."nameTh", 'timeZone', d."timeZone")
      END AS "dropoffLocation"
    FROM bookings b JOIN cars c ON c.id = b."carId"
    LEFT JOIN locations p ON p.id = b."pickupLocationId"
    LEFT JOIN locations d ON d.id = b."dropoffLocationId"
    WHERE b."userId" = $1 ORDER BY b."createdAt" DESC, b.id`, [userId]);
}

export function findBooking(db: Database, id: string) {
  return queryOne<Booking>(db, "SELECT * FROM bookings WHERE id = $1", [id]);
}

export async function createBooking(db: Database, input: Record<string, unknown>) {
  // Existing booking references have a leading c and 24 lowercase base-36 characters.
  const random = BigInt("0x" + randomBytes(16).toString("hex")).toString(36);
  const bookingNumber = "c" + random.padStart(24, "0").slice(-24);
  const [created] = await insertRows(db, "bookings", [{ ...input, bookingNumber }]);
  return required(await queryOne(db, `SELECT b.*, ${carJson} AS car,
    jsonb_build_object('id', u.id, 'name', u.name, 'email', u.email) AS "user"
    FROM bookings b JOIN cars c ON c.id = b."carId" JOIN users u ON u.id = b."userId"
    WHERE b.id = $1`, [created.id]));
}
