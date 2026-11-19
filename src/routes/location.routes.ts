import { Router, Request, Response } from "express";
import prisma from "../lib/prisma.js";

const router = Router();

// GET /api/locations - รายการจุดรับรถทั้งหมด รองรับ filter ตาม countryCode
router.get("/", async (req: Request, res: Response) => {
  try {
    const { countryCode, city } = req.query;

    const where: any = {};
    if (countryCode && countryCode !== "all") {
      where.countryCode = String(countryCode).toUpperCase();
    }
    if (city) {
      where.OR = [
        { city: { contains: String(city), mode: "insensitive" } },
        { cityTh: { contains: String(city) } },
      ];
    }

    const locations = await prisma.location.findMany({
      where,
      include: {
        country: true,
      },
      orderBy: [{ countryCode: "asc" }, { city: "asc" }, { name: "asc" }],
    });

    const data = locations.map((loc) => ({
      id: loc.id,
      name: loc.name,
      nameTh: loc.nameTh,
      city: loc.city,
      cityTh: loc.cityTh,
      countryCode: loc.countryCode,
      airportCode: loc.airportCode,
      timeZone: loc.timeZone,
      country: loc.country,
      label: `${loc.cityTh} - ${loc.nameTh}${loc.airportCode ? ` (${loc.airportCode})` : ""}`,
    }));

    res.json({ success: true, count: data.length, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/locations/:id - ข้อมูลจุดรับรถตาม ID
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const loc = await prisma.location.findUnique({
      where: { id },
      include: {
        country: true,
      },
    });

    if (!loc) {
      return res
        .status(404)
        .json({ success: false, message: "Location not found" });
    }

    res.json({
      success: true,
      data: {
        id: loc.id,
        name: loc.name,
        nameTh: loc.nameTh,
        city: loc.city,
        cityTh: loc.cityTh,
        countryCode: loc.countryCode,
        airportCode: loc.airportCode,
        timeZone: loc.timeZone,
        country: loc.country,
        label: `${loc.cityTh} - ${loc.nameTh}${loc.airportCode ? ` (${loc.airportCode})` : ""}`,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
