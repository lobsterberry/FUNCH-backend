import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { requireAdmin, requireJson } from '../middleware/auth.js';

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
router.post('/', requireJson, requireAdmin, async (req: Request, res: Response) => {
  try {
    const {
      brand,
      model,
      year,
      licensePlate,
      country,
      hourlyRate,
      dailyRate,
      seats,
      transmission,
      fuelType,
      imageUrl,
      options,
      locationId,
      categories,
      categoryLabel,
    } = req.body;

    const car = await prisma.car.create({
      data: {
        brand,
        model,
        year: Number(year),
        licensePlate,
        country: country.toUpperCase(),
        hourlyRate: Number(hourlyRate),
        dailyRate: Number(dailyRate),
        seats: seats ? Number(seats) : 4,
        transmission: transmission || 'Automatic',
        fuelType: fuelType || 'Gasoline',
        imageUrl,
        options,
        locationId,
        categories: categories || [],
        categoryLabel,
      },
      include: {
        location: true,
        countryInfo: true,
      },
    });

    res.status(201).json({ success: true, data: formatCar(car) });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

export default router;
