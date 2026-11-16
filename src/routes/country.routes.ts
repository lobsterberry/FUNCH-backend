import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma.js';

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

function formatCountry(c: {
  code: string;
  name: string;
  nameTh: string;
  flag: string;
  currencyCode: string;
  drivingSide: string;
  locations: Array<{
    id: string;
    name: string;
    nameTh: string;
    city: string;
    cityTh: string;
    airportCode: string | null;
    timeZone: string;
  }>;
}) {
  const sortedLocations = [...c.locations].sort((a, b) => {
    const prioA = (a.airportCode ? PRIMARY_AIRPORT_ORDER[a.airportCode] : undefined) ?? 99;
    const prioB = (b.airportCode ? PRIMARY_AIRPORT_ORDER[b.airportCode] : undefined) ?? 99;
    if (prioA !== prioB) return prioA - prioB;
    return a.name.localeCompare(b.name);
  });

  const primaryLoc = sortedLocations[0];
  const airportTag = primaryLoc?.airportCode ? ` (${primaryLoc.airportCode} Airport)` : '';
  const locationLabel = primaryLoc
    ? `${primaryLoc.cityTh} - ${primaryLoc.nameTh}${airportTag}`
    : '';

  // Unique list of cities in Thai for this country (with primary city first)
  const cities = Array.from(new Set(sortedLocations.map((l) => l.cityTh).filter(Boolean)));

  return {
    code: c.code,
    name: c.nameTh,
    english: c.name,
    flag: c.flag,
    currencyCode: c.currencyCode,
    drivingSide: c.drivingSide,
    steering: (c.drivingSide === 'LEFT' ? 'right' : 'left') as 'right' | 'left',
    city: primaryLoc?.cityTh || '',
    location: locationLabel,
    cities,
    locations: sortedLocations,
  };
}

// GET /api/countries - รายการประเทศทั้งหมด พร้อมข้อมูลจุดรับรถและเมือง
router.get('/', async (_req: Request, res: Response) => {
  try {
    const countries = await prisma.country.findMany({
      include: {
        locations: {
          orderBy: { name: 'asc' },
        },
      },
    });

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
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/countries/:code - ข้อมูลประเทศตามรหัส เช่น JP, TH
router.get('/:code', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const country = await prisma.country.findUnique({
      where: { code: String(code).toUpperCase() },
      include: {
        locations: {
          orderBy: { name: 'asc' },
        },
      },
    });

    if (!country) {
      return res.status(404).json({ success: false, message: 'Country not found' });
    }

    res.json({
      success: true,
      data: formatCountry(country),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
