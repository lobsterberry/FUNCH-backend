import { Prisma, type BookingStatus } from "@prisma/client";
import { z } from "zod";

export const REPORT_TIME_ZONE = "Asia/Bangkok";
const DAY = 86_400_000;
export const reportDay = (value: Date) =>
  new Date(value.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
export const shiftDay = (day: string, offset: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + offset * DAY)
    .toISOString()
    .slice(0, 10);
export const dayBoundary = (day: string) => new Date(`${day}T00:00:00+07:00`);
const calendarDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value &&
      value >= "2000-01-01" &&
      value <= "2100-12-31"
    );
  }, "Invalid calendar date");

export function reportQuery(now = new Date()) {
  const today = reportDay(now);
  return z
    .object({
      start: calendarDay.default(shiftDay(today, -29)),
      end: calendarDay.default(today),
      basis: z.enum(["createdAt", "startDateTime"]).default("createdAt"),
      comparison: z.enum(["previous", "year", "none"]).default("previous"),
      country: z
        .string()
        .regex(/^(all|[A-Z]{2})$/)
        .default("all"),
      category: z
        .enum(["all", "SUV", "SEDAN", "MPV", "EV", "ECO", "LUXURY", "WAGON"])
        .default("all"),
      currency: z
        .string()
        .regex(/^(all|[A-Z]{3})$/)
        .default("all"),
      page: z.coerce.number().int().min(1).max(1_000_000).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(10),
      format: z.enum(["json", "csv"]).default("json"),
    })
    .refine(
      (input) =>
        input.end >= input.start &&
        Date.parse(input.end) - Date.parse(input.start) < 366 * DAY,
      "Select a date range of 1–366 days",
    );
}
export type ReportInput = z.infer<ReturnType<typeof reportQuery>>;

export function comparisonRange(
  input: Pick<ReportInput, "start" | "end" | "comparison">,
) {
  if (input.comparison === "none") return null;
  if (input.comparison === "year") {
    // Clamp leap day to the final day of February in the previous year.
    const previousYear = (day: string) => {
      const date = new Date(`${day}T00:00:00Z`);
      const month = date.getUTCMonth();
      date.setUTCFullYear(date.getUTCFullYear() - 1);
      if (date.getUTCMonth() !== month) date.setUTCDate(0);
      return date.toISOString().slice(0, 10);
    };
    return { start: previousYear(input.start), end: previousYear(input.end) };
  }
  const days = (Date.parse(input.end) - Date.parse(input.start)) / DAY + 1;
  return {
    start: shiftDay(input.start, -days),
    end: shiftDay(input.start, -1),
  };
}

export const reportSelect = {
  id: true,
  bookingNumber: true,
  createdAt: true,
  startDateTime: true,
  endDateTime: true,
  totalPrice: true,
  currencyCode: true,
  status: true,
  source: true,
  timeZone: true,
  carId: true,
  carSnapshot: true,
  calculatedDays: true,
  calculatedHours: true,
  car: {
    select: {
      brand: true,
      model: true,
      licensePlate: true,
      country: true,
      countryInfo: { select: { code: true, nameTh: true, flag: true } },
    },
  },
  pickupLocation: {
    select: {
      nameTh: true,
      country: { select: { code: true, nameTh: true, flag: true } },
    },
  },
} satisfies Prisma.BookingSelect;
export type ReportBooking = Prisma.BookingGetPayload<{
  select: typeof reportSelect;
}>;
export const statusLabels: Record<BookingStatus, string> = {
  PENDING: "รออนุมัติ",
  APPROVED: "อนุมัติแล้ว",
  COMPLETED: "เสร็จสิ้น",
  CANCELLED: "ยกเลิก",
  REJECTED: "ไม่อนุมัติ",
};
const zero = () => new Prisma.Decimal(0);
const confirmed = (status: BookingStatus) =>
  status === "APPROVED" || status === "COMPLETED";

export function reportSummary(bookings: ReportBooking[]) {
  const statuses = Object.fromEntries(
    Object.keys(statusLabels).map((key) => [key, 0]),
  ) as Record<BookingStatus, number>;
  const currencies = new Map<
    string,
    {
      currency: string;
      total: Prisma.Decimal;
      approved: Prisma.Decimal;
      completed: Prisma.Decimal;
      pending: Prisma.Decimal;
      excluded: Prisma.Decimal;
      confirmedCount: number;
    }
  >();
  for (const booking of bookings) {
    statuses[booking.status]++;
    let totals = currencies.get(booking.currencyCode);
    if (!totals) {
      totals = {
        currency: booking.currencyCode,
        total: zero(),
        approved: zero(),
        completed: zero(),
        pending: zero(),
        excluded: zero(),
        confirmedCount: 0,
      };
      currencies.set(booking.currencyCode, totals);
    }
    totals.total = totals.total.add(booking.totalPrice);
    if (confirmed(booking.status)) totals.confirmedCount++;
    const key =
      booking.status === "APPROVED"
        ? "approved"
        : booking.status === "COMPLETED"
          ? "completed"
          : booking.status === "PENDING"
            ? "pending"
            : "excluded";
    totals[key] = totals[key].add(booking.totalPrice);
  }
  const confirmedCount = statuses.APPROVED + statuses.COMPLETED;
  return {
    total: bookings.length,
    confirmedCount,
    statuses,
    approvalRate: bookings.length
      ? (confirmedCount / bookings.length) * 100
      : 0,
    currencies: [...currencies.values()]
      .sort((a, b) => a.currency.localeCompare(b.currency))
      .map((item) => ({
        currency: item.currency,
        total: item.total.toFixed(2),
        approved: item.approved.toFixed(2),
        completed: item.completed.toFixed(2),
        pending: item.pending.toFixed(2),
        excluded: item.excluded.toFixed(2),
        confirmed: item.approved.add(item.completed).toFixed(2),
        average: item.confirmedCount
          ? item.approved
              .add(item.completed)
              .div(item.confirmedCount)
              .toFixed(2)
          : "0.00",
      })),
  };
}

export function bookingRow(booking: ReportBooking) {
  const snapshot =
    booking.carSnapshot &&
    typeof booking.carSnapshot === "object" &&
    !Array.isArray(booking.carSnapshot)
      ? booking.carSnapshot
      : {};
  const text = (field: string, fallback: string) =>
    typeof snapshot[field] === "string"
      ? (snapshot[field] as string)
      : fallback;
  const country = booking.pickupLocation?.country ?? booking.car.countryInfo;
  return {
    id: booking.id,
    bookingNumber: booking.bookingNumber,
    createdAt: booking.createdAt.toISOString(),
    startDateTime: booking.startDateTime.toISOString(),
    endDateTime: booking.endDateTime.toISOString(),
    carId: booking.carId,
    carName: `${text("brand", booking.car.brand)} ${text("model", booking.car.model)}`,
    licensePlate: text("licensePlate", booking.car.licensePlate),
    country,
    pickup: text(
      "pickupLocationName",
      booking.pickupLocation?.nameTh ?? "ไม่ระบุสาขา",
    ),
    status: booking.status,
    source: booking.source,
    currency: booking.currencyCode,
    amount: booking.totalPrice.toFixed(2),
    timeZone: booking.timeZone,
  };
}

export function buildReport(bookings: ReportBooking[], input: ReportInput) {
  const monthly = Date.parse(input.end) - Date.parse(input.start) >= 62 * DAY;
  const trend = new Map<
    string,
    { date: string; bookings: number; amounts: Map<string, Prisma.Decimal> }
  >();
  for (let day = input.start; day <= input.end; day = shiftDay(day, 1)) {
    const key = monthly ? day.slice(0, 7) : day;
    if (!trend.has(key))
      trend.set(key, { date: key, bookings: 0, amounts: new Map() });
  }
  const countries = new Map<
    string,
    {
      code: string;
      nameTh: string;
      flag: string;
      count: number;
      amounts: Map<string, Prisma.Decimal>;
    }
  >();
  const cars = new Map<
    string,
    {
      carId: string;
      name: string;
      licensePlate: string;
      currency: string;
      count: number;
      amount: Prisma.Decimal;
    }
  >();
  const sources = { EXISTING_MEMBER: 0, REGISTER_AND_BOOK: 0 };
  let daily = 0;
  for (const booking of bookings) {
    const row = bookingRow(booking);
    const day = reportDay(booking[input.basis]);
    const bucket = trend.get(monthly ? day.slice(0, 7) : day)!;
    bucket.bookings++;
    sources[booking.source]++;
    if (booking.calculatedDays > 0) daily++;
    let country = countries.get(row.country.code);
    if (!country) {
      country = { ...row.country, count: 0, amounts: new Map() };
      countries.set(country.code, country);
    }
    country.count++;
    if (!confirmed(booking.status)) continue;
    for (const amounts of [bucket.amounts, country.amounts])
      amounts.set(
        booking.currencyCode,
        (amounts.get(booking.currencyCode) ?? zero()).add(booking.totalPrice),
      );
    // A car may have bookings in multiple currencies; rank each currency separately.
    const key = `${booking.carId}:${booking.currencyCode}`;
    let car = cars.get(key);
    if (!car) {
      car = {
        carId: booking.carId,
        name: row.carName,
        licensePlate: row.licensePlate,
        currency: booking.currencyCode,
        count: 0,
        amount: zero(),
      };
      cars.set(key, car);
    }
    car.count++;
    car.amount = car.amount.add(booking.totalPrice);
  }
  const amountsJson = (values: Map<string, Prisma.Decimal>) =>
    Object.fromEntries(
      [...values].map(([key, value]) => [key, value.toFixed(2)]),
    );
  const totalPages = Math.max(1, Math.ceil(bookings.length / input.pageSize));
  const page = Math.min(input.page, totalPages);
  return {
    summary: reportSummary(bookings),
    interval: monthly ? "month" : "day",
    trend: [...trend.values()].map((item) => ({
      ...item,
      amounts: amountsJson(item.amounts),
    })),
    countries: [...countries.values()]
      .sort((a, b) => b.count - a.count)
      .map((item) => ({ ...item, amounts: amountsJson(item.amounts) })),
    topCars: [...cars.values()]
      .sort(
        (a, b) =>
          a.currency.localeCompare(b.currency) ||
          b.amount.comparedTo(a.amount) ||
          a.carId.localeCompare(b.carId),
      )
      .map((car) => ({ ...car, amount: car.amount.toFixed(2) })),
    sources,
    pricing: { daily, hourlyOnly: bookings.length - daily },
    bookings: bookings
      .slice((page - 1) * input.pageSize, page * input.pageSize)
      .map(bookingRow),
    pagination: {
      page,
      pageSize: input.pageSize,
      total: bookings.length,
      totalPages,
    },
  };
}

export function reportCsv(bookings: ReportBooking[], input: ReportInput) {
  const cell = (value: unknown) => {
    const text = String(value ?? "");
    return `"${(/^[\s]*[=+@-]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`;
  };
  const summary = reportSummary(bookings);
  const rows: unknown[][] = [
    ["FUNCH รายงานสรุปยอดจองรถ"],
    [
      "เริ่ม",
      input.start,
      "สิ้นสุด",
      input.end,
      "เขตเวลารายงาน",
      REPORT_TIME_ZONE,
    ],
    [
      "อ้างอิง",
      input.basis === "createdAt" ? "วันที่ทำรายการจอง" : "วันที่รับรถ",
      "ประเทศ",
      input.country,
      "หมวดรถ",
      input.category,
      "สกุลเงิน",
      input.currency,
    ],
    ["ยอดตามสถานะปัจจุบัน ไม่ใช่ยอดรับชำระ ไม่รวมการแปลงสกุลเงิน"],
    [
      "สกุลเงิน",
      "มูลค่าจองทั้งหมด",
      "อนุมัติ",
      "เสร็จสิ้น",
      "รออนุมัติ",
      "ยกเลิก/ไม่อนุมัติ",
      "อนุมัติ+เสร็จสิ้น",
    ],
    ...summary.currencies.map((item) => [
      item.currency,
      item.total,
      item.approved,
      item.completed,
      item.pending,
      item.excluded,
      item.confirmed,
    ]),
    [],
    [
      "เลขการจอง",
      "วันที่จอง (ISO UTC)",
      "รับรถ (ISO UTC)",
      "คืนรถ (ISO UTC)",
      "เขตเวลารับรถ",
      "รถ",
      "ทะเบียน",
      "ประเทศ",
      "สาขารับรถ",
      "สถานะ",
      "โฟลวการจอง",
      "สกุลเงิน",
      "มูลค่าการจอง",
    ],
    ...bookings.map((booking) => {
      const row = bookingRow(booking);
      return [
        row.bookingNumber,
        row.createdAt,
        row.startDateTime,
        row.endDateTime,
        row.timeZone,
        row.carName,
        row.licensePlate,
        row.country.nameTh,
        row.pickup,
        statusLabels[row.status],
        row.source,
        row.currency,
        row.amount,
      ];
    }),
  ];
  return "\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n");
}
