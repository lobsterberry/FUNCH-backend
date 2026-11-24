import { Router } from "express";
import { queryRows, withTransaction, type Database } from "../lib/db.js";
import { requireAdmin } from "../middleware/auth.js";
import {
  buildReport,
  comparisonRange,
  dayBoundary,
  reportCsv,
  reportQuery,
  type ReportBooking,
  type ReportInput,
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
    const result = await withTransaction(
      async (tx) => {
        const bookings = await reportBookings(tx, input, input);
        if (input.format === "csv") return { csv: reportCsv(bookings, input) };
        const previous = comparison ? await reportBookings(tx, input, comparison) : null;
        const countries = await queryRows(tx, 'SELECT code, "nameTh", flag FROM countries ORDER BY name');
        const currencies = await queryRows<{ currencyCode: string }>(
          tx, 'SELECT DISTINCT "currencyCode" FROM bookings ORDER BY "currencyCode"',
        );
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
      { repeatableRead: true, timeoutMs: 20_000 },
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

const reportBasis = { createdAt: 'b."createdAt"', startDateTime: 'b."startDateTime"' };

function reportBookings(db: Database, input: ReportInput, range: { start: string; end: string }) {
  const basis = reportBasis[input.basis];
  return queryRows<ReportBooking>(db, `
    SELECT b.id, b."bookingNumber", b."createdAt", b."startDateTime", b."endDateTime",
      b."totalPrice", b."currencyCode", b.status, b.source, b."timeZone", b."carId",
      b."carSnapshot", b."calculatedDays", b."calculatedHours",
      jsonb_build_object('brand', c.brand, 'model', c.model, 'licensePlate', c."licensePlate",
        'country', c.country, 'countryInfo',
        jsonb_build_object('code', co.code, 'nameTh', co."nameTh", 'flag', co.flag)) AS car,
      CASE WHEN p.id IS NOT NULL THEN jsonb_build_object('nameTh', p."nameTh", 'country',
        jsonb_build_object('code', pc.code, 'nameTh', pc."nameTh", 'flag', pc.flag))
      END AS "pickupLocation"
    FROM bookings b
    JOIN cars c ON c.id = b."carId"
    JOIN countries co ON co.code = c.country
    LEFT JOIN locations p ON p.id = b."pickupLocationId"
    LEFT JOIN countries pc ON pc.code = p."countryCode"
    WHERE ${basis} >= $1 AND ${basis} < $2
      AND ($3::text IS NULL OR b."currencyCode"::text = $3)
      AND ($4::text IS NULL OR COALESCE(p."countryCode"::text, c.country) = $4)
      AND ($5::"CarCategory" IS NULL OR $5 = ANY(c.categories))
    ORDER BY ${basis} DESC, b.id`, [
      dayBoundary(range.start), dayBoundary(shiftDay(range.end, 1)),
      input.currency === "all" ? null : input.currency,
      input.country === "all" ? null : input.country,
      input.category === "all" ? null : input.category,
    ]);
}

export default router;
