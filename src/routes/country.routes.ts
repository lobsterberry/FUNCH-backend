import { Router } from "express";
import { readCountries } from "../lib/locations.js";

const router = Router();

const COUNTRY_ORDER: Record<string, number> = {
  JP: 1,
  TH: 2,
  DE: 3,
  GB: 4,
  US: 5,
  SG: 6,
};

const PRIMARY_AIRPORT_ORDER: Record<string, number> = {
  HND: 1,
  BKK: 1,
  FRA: 1,
  LHR: 1,
  LAX: 1,
  SIN: 1,
};

function formatCountry(c: Awaited<ReturnType<typeof readCountries>>[number]) {
  const sortedLocations = [...c.locations].sort((a, b) => {
    const prioA =
      (a.airportCode ? PRIMARY_AIRPORT_ORDER[a.airportCode] : undefined) ?? 99;
    const prioB =
      (b.airportCode ? PRIMARY_AIRPORT_ORDER[b.airportCode] : undefined) ?? 99;
    if (prioA !== prioB) return prioA - prioB;
    return a.name.localeCompare(b.name);
  });

  const primaryLoc = sortedLocations[0];
  const airportTag = primaryLoc?.airportCode
    ? ` (${primaryLoc.airportCode} Airport)`
    : "";
  const locationLabel = primaryLoc
    ? `${primaryLoc.cityTh} - ${primaryLoc.nameTh}${airportTag}`
    : "";

  // Unique list of cities in Thai for this country (with primary city first)
  const cities = Array.from(
    new Set(sortedLocations.map((l) => l.cityTh).filter(Boolean)),
  );

  return {
    code: c.code,
    name: c.nameTh,
    english: c.name,
    flag: c.flag,
    currencyCode: c.currencyCode,
    drivingSide: c.drivingSide,
    steering: (c.drivingSide === "LEFT" ? "right" : "left") as "right" | "left",
    city: primaryLoc?.cityTh || "",
    location: locationLabel,
    cities,
    locations: sortedLocations,
  };
}

// GET /api/countries - รายการประเทศทั้งหมด พร้อมข้อมูลจุดรับรถและเมือง
router.get("/", async (_req, res, next) => {
  try {
    const countries = await readCountries();

    const sorted = [...countries].sort((a, b) => {
      const orderA = COUNTRY_ORDER[a.code] ?? 999;
      const orderB = COUNTRY_ORDER[b.code] ?? 999;
      if (orderA !== orderB) return orderA - orderB;
      return a.code.localeCompare(b.code);
    });

    const data = sorted.map(formatCountry);

    res.json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/countries/:code - ข้อมูลประเทศตามรหัส เช่น JP, TH
router.get("/:code", async (req, res, next) => {
  try {
    const { code } = req.params;
    const [country] = await readCountries(code.toUpperCase());

    if (!country) {
      return res
        .status(404)
        .json({ success: false, message: "Country not found" });
    }

    res.json({
      success: true,
      data: formatCountry(country),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
