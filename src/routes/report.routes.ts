import { Router } from "express";
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma.js";
import { requireAdmin } from "../middleware/auth.js";
import {
  buildReport,
  comparisonRange,
  dayBoundary,
  reportCsv,
  reportQuery,
  reportSelect,
  reportSummary,
  shiftDay,
  REPORT_TIME_ZONE,
} from "../lib/booking-report.js";

const router = Router();
router.use(requireAdmin);
router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
router.get("/", async (req, res, next) => {
  try {
    const input = reportQuery().parse(req.query);
    const comparison = comparisonRange(input);
    const filters: Prisma.BookingWhereInput = {
      ...(input.currency === "all" ? {} : { currencyCode: input.currency }),
      ...(input.country === "all"
        ? {}
        : {
            OR: [
              { pickupLocation: { countryCode: input.country } },
              { pickupLocationId: null, car: { country: input.country } },
            ],
          }),
      ...(input.category === "all"
        ? {}
        : { car: { categories: { has: input.category } } }),
    };
    const periodWhere = (range: {
      start: string;
      end: string;
    }): Prisma.BookingWhereInput => ({
      ...filters,
      [input.basis]: {
        gte: dayBoundary(range.start),
        lt: dayBoundary(shiftDay(range.end, 1)),
      },
    });
    const result = await prisma.$transaction(
      async (tx) => {
        const bookings = await tx.booking.findMany({
          where: periodWhere(input),
          select: reportSelect,
          orderBy: [{ [input.basis]: "desc" }, { id: "asc" }],
        });
        if (input.format === "csv") return { csv: reportCsv(bookings, input) };
        const previous = comparison
          ? await tx.booking.findMany({
              where: periodWhere(comparison),
              select: reportSelect,
            })
          : null;
        const countries = await tx.country.findMany({
          select: { code: true, nameTh: true, flag: true },
          orderBy: { name: "asc" },
        });
        const currencies = await tx.booking.findMany({
          distinct: ["currencyCode"],
          select: { currencyCode: true },
          orderBy: { currencyCode: "asc" },
        });
        return {
          data: {
            ...buildReport(bookings, input),
            comparison:
              comparison && previous
                ? { ...comparison, summary: reportSummary(previous) }
                : null,
            filters: input,
            timeZone: REPORT_TIME_ZONE,
            generatedAt: new Date().toISOString(),
            options: {
              countries,
              currencies: currencies.map((row) => row.currencyCode),
            },
          },
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 20_000,
      },
    );
    if ("csv" in result) {
      res
        .type("text/csv; charset=utf-8")
        .attachment(`funch-booking-report-${input.start}-${input.end}.csv`)
        .send(result.csv);
    } else res.json({ success: true, data: result.data });
  } catch (error) {
    next(error);
  }
});
export default router;
