import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { requireAdmin, requireJson } from '../middleware/auth.js';
import { carInputSchema } from '../lib/car-input.js';

const router = Router();

export function formatCar(car: any) {
  const brand = car.brand || '';
  const model = car.model || '';
  const fullName = brand && !model.startsWith(brand) ? `${brand} ${model}` : model;
  const fuel = car.fuelType || 'Gasoline';
  const color =
    fuel === 'EV'
      ? 'text-blue-600'
      : fuel === 'Hybrid'
        ? 'text-emerald-700'
        : car.categories?.includes('LUXURY')
          ? 'text-slate-800'
          : 'text-slate-700';

  const category =
    car.categoryLabel ||
    car.categories?.[0] ||
    'Sedan';

  const features = Array.isArray(car.options)
    ? car.options.map((opt: any) => (typeof opt === 'string' ? opt : opt.label || opt.code))
    : car.featureCodes || [];

  return {
    id: car.id,
    brand: car.brand,
    name: fullName,
    model: `${fullName} ${car.year || 2024}`,
    country: car.country,
    city: car.location?.cityTh || car.location?.city || '',
    category,
    badge: car.badge || car.categoryLabel || category,
    description: car.description || '',
    seats: car.seats ?? 4,
    bags: car.luggageCapacity ?? 2,
    gear: car.transmission || 'Automatic',
    fuel,
    steering: car.steeringSide === 'RHD' ? ('right' as const) : ('left' as const),
    day: Number(car.dailyRate),
    hour: Number(car.hourlyRate),
    hourlyRate: car.hourlyRate,
    dailyRate: car.dailyRate,
    currencyCode: car.currencyCode || 'THB',
    rating: Number(car.rating) || 4.8,
    reviews: car.reviewCount || 0,
    features,
    provider: car.providerName || 'FUNCH Rental',
    color,
    featured: Boolean(car.isFeatured),
    isAvailable: car.isAvailable !== false,
    licensePlate: car.licensePlate,
    locationId: car.locationId,
    location: car.location,
    countryInfo: car.countryInfo,
  };
}

// GET /api/cars/meta - ดึงข้อมูล category, fuel, features ที่มีอยู่ในฐานข้อมูล
router.get('/meta', async (_req: Request, res: Response) => {
  try {
    const cars = await prisma.car.findMany({
      select: {
        categories: true,
        categoryLabel: true,
        fuelType: true,
        transmission: true,
        options: true,
      },
    });

    const categorySet = new Set<string>();
    const fuelSet = new Set<string>();
    const featureSet = new Set<string>();

    for (const c of cars) {
      if (c.categories) c.categories.forEach((cat) => categorySet.add(cat));
      if (c.categoryLabel) categorySet.add(c.categoryLabel);
      if (c.fuelType) fuelSet.add(c.fuelType);
      if (Array.isArray(c.options)) {
        c.options.forEach((opt: any) => {
          if (opt?.label) featureSet.add(opt.label);
        });
      }
    }

    res.json({
      success: true,
      data: {
        categories: Array.from(categorySet),
        fuels: Array.from(fuelSet),
        features: Array.from(featureSet),
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/cars - รายการรถทั้งหมด รองรับ filter ตาม country, category, isAvailable
router.get('/', async (req: Request, res: Response) => {
  try {
    const { country, isAvailable, category, locationId } = req.query;

    const where: any = {};
    if (country && country !== 'all') {
      where.country = String(country).toUpperCase();
    }
    if (isAvailable !== undefined) {
      where.isAvailable = isAvailable === 'true';
    }
    if (category && category !== 'all') {
      where.OR = [
        { categories: { has: String(category).toUpperCase() as any } },
        { categoryLabel: { contains: String(category), mode: 'insensitive' } },
      ];
    }
    if (locationId) {
      where.locationId = String(locationId);
    }

    const cars = await prisma.car.findMany({
      where,
      include: {
        location: true,
        countryInfo: true,
      },
      orderBy: [
        { isFeatured: 'desc' },
        { recommendationOrder: 'asc' },
        { createdAt: 'desc' },
      ],
    });

    const data = cars.map(formatCar);
    res.json({ success: true, count: data.length, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Administrative inventory includes live booking state and unformatted edit values.
router.get('/admin', requireAdmin, async (_req, res, next) => {
  try {
    const now = new Date();
    const cars = await prisma.car.findMany({
      include: {
        location: true, countryInfo: true,
        bookings: {
          where: { status: { in: ['PENDING', 'APPROVED'] }, endDateTime: { gt: now } },
          select: { startDateTime: true },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    res.set('Cache-Control', 'no-store').json({ success: true, data: cars.map((car) => ({
      ...formatCar(car), rawModel: car.model, year: car.year, categories: car.categories,
      transmissionType: car.transmissionType, featureCodes: car.featureCodes, options: car.options,
      rentalStatus: car.bookings.some((booking) => booking.startDateTime <= now)
        ? 'IN_USE' : car.bookings.length ? 'RESERVED' : 'IDLE',
    })) });
  } catch (error) { next(error); }
});

// GET /api/cars/:id - ดูรายละเอียดรถคนนั้นทั้งหมด
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const car = await prisma.car.findUnique({
      where: { id },
      include: {
        location: true,
        countryInfo: true,
      },
    });

    if (!car) {
      return res.status(404).json({ success: false, message: 'Car not found' });
    }

    res.json({ success: true, data: formatCar(car) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/cars - เพิ่มข้อมูลรถ (สำหรับระบบหลังบ้าน Admin)
router.post('/', requireJson, requireAdmin, async (req, res, next) => {
  try {
    const data = carInputSchema.parse(req.body);
    if (!await validCarLocation(data.country, data.locationId)) {
      res.status(400).json({ success: false, message: 'Country and pickup location must match' });
      return;
    }
    const car = await prisma.car.create({
      data,
      include: {
        location: true,
        countryInfo: true,
      },
    });

    res.status(201).json({ success: true, data: formatCar(car) });
  } catch (error) { next(error); }
});

async function validCarLocation(country: string, locationId: string | null) {
  if (!await prisma.country.findUnique({ where: { code: country } })) return false;
  if (!locationId) return true;
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  return location?.countryCode === country;
}

router.patch('/:id', requireJson, requireAdmin, async (req, res, next) => {
  try {
    const data = carInputSchema.parse(req.body);
    if (!await validCarLocation(data.country, data.locationId)) {
      res.status(400).json({ success: false, message: 'Country and pickup location must match' });
      return;
    }
    const car = await prisma.$transaction(async (tx) => {
      // Share the reservation lock so a car cannot move while a booking is created.
      await tx.$queryRaw`SELECT id FROM cars WHERE id = ${req.params.id} FOR UPDATE`;
      const existing = await tx.car.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new Error('CAR_NOT_FOUND');
      if (existing.country !== data.country || existing.locationId !== data.locationId) {
        const booking = await tx.booking.findFirst({ where: {
          carId: existing.id, status: { in: ['PENDING', 'APPROVED'] }, endDateTime: { gt: new Date() },
        } });
        if (booking) throw new Error('CAR_LOCATION_BOOKED');
      }
      return tx.car.update({
        where: { id: existing.id }, data, include: { location: true, countryInfo: true },
      });
    });
    res.json({ success: true, data: formatCar(car) });
  } catch (error) {
    if (error instanceof Error && error.message === 'CAR_NOT_FOUND') {
      res.status(404).json({ success: false, message: 'Car not found' }); return;
    }
    if (error instanceof Error && error.message === 'CAR_LOCATION_BOOKED') {
      res.status(409).json({ success: false, message: 'Car has upcoming bookings; location cannot change' }); return;
    }
    next(error);
  }
});

export default router;
