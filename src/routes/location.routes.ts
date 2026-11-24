import { Router } from "express";
import { readLocations } from "../lib/locations.js";

const router = Router();

function formatLocation(location: Awaited<ReturnType<typeof readLocations>>[number]) {
  const airport = location.airportCode ? ` (${location.airportCode})` : "";
  return {
    ...location,
    label: `${location.cityTh} - ${location.nameTh}${airport}`,
  };
}

// GET /api/locations - รายการจุดรับรถทั้งหมด รองรับ filter ตาม countryCode
router.get("/", async (req, res, next) => {
  try {
    const { countryCode, city } = req.query;
    const locations = await readLocations({
      countryCode: countryCode && countryCode !== "all"
        ? String(countryCode).toUpperCase()
        : undefined,
      city: city ? String(city) : undefined,
    });
    const data = locations.map(formatLocation);

    res.json({ success: true, count: data.length, data });
  } catch (error) {
    next(error);
  }
});

// GET /api/locations/:id - ข้อมูลจุดรับรถตาม ID
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const [location] = await readLocations({ id });

    if (!location) {
      return res
        .status(404)
        .json({ success: false, message: "Location not found" });
    }

    res.json({
      success: true,
      data: formatLocation(location),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
