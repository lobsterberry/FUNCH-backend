import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { requireAdmin, requireJson } from '../middleware/auth.js';

const router = Router();

// GET /api/cars - รายการรถทั้งหมด รองรับ filter ตาม country
router.get('/', async (req: Request, res: Response) => {
  try {
    const { country, isAvailable } = req.query;

    const where: any = {};
    if (country) {
      where.country = String(country).toUpperCase();
    }
    if (isAvailable !== undefined) {
      where.isAvailable = isAvailable === 'true';
    }

    const cars = await prisma.car.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, count: cars.length, data: cars });
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
    });

    if (!car) {
      return res.status(404).json({ success: false, message: 'Car not found' });
    }

    res.json({ success: true, data: car });
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
      },
    });

    res.status(201).json({ success: true, data: car });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

export default router;

