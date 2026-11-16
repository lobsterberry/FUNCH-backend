import { Router } from 'express';
import { BookingStatus } from '@prisma/client';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { registrationSchema, registrationData } from '../lib/registration.js';
import { requireAdmin, requireJson } from '../middleware/auth.js';
import { calculateCarRentalPrice } from '../utils/pricing.js';

const router = Router();
const rentalSchema = z.object({
  carId: z.string().min(1),
  startDateTime: z.string().datetime({ offset: true }),
  endDateTime: z.string().datetime({ offset: true }),
}).refine((data) => new Date(data.endDateTime) > new Date(data.startDateTime), {
  message: 'Return time must be after pickup time', path: ['endDateTime'],
});
const bookingSchema = z.object({
  carId: z.string().min(1),
  startDateTime: z.string().datetime({ offset: true }),
  endDateTime: z.string().datetime({ offset: true }),
  registerUser: registrationSchema.optional(),
  userId: z.string().min(1).optional(),
}).strict();
const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { success: false, message: 'Too many booking attempts. Please try again later.' },
});

router.post('/calculate', requireJson, async (req, res, next) => {
  try {
    const input = rentalSchema.parse(req.body);
    const car = await prisma.car.findUnique({ where: { id: input.carId } });
    if (!car) { res.status(404).json({ success: false, message: 'Car not found' }); return; }
    const result = calculateCarRentalPrice({
      ...input, hourlyRate: Number(car.hourlyRate), dailyRate: Number(car.dailyRate),
    });
    res.json({ success: true, data: {
      car: { id: car.id, name: `${car.brand} ${car.model}`, hourlyRate: car.hourlyRate, dailyRate: car.dailyRate },
      calculation: result,
    } });
  } catch (error) { next(error); }
});

// Booking lists and approvals are restricted to administrators.
router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const status = z.nativeEnum(BookingStatus).optional().parse(req.query.status);
    const bookings = await prisma.booking.findMany({
      where: { status },
      include: {
        car: true,
        user: { select: { id: true, name: true, email: true, phoneNumber: true } },
        approvedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, count: bookings.length, data: bookings });
  } catch (error) { next(error); }
});

router.post('/', requireJson, bookingLimiter, async (req, res, next) => {
  try {
    const input = bookingSchema.parse(req.body);
    const memberId: string | undefined = res.locals.session?.user?.id;
    if (!memberId && !input.registerUser) {
      res.status(401).json({ success: false, message: 'Sign in or provide registerUser to book a car' }); return;
    }
    if (input.userId && input.userId !== memberId) {
      res.status(403).json({ success: false, message: 'Cannot book on behalf of another user' }); return;
    }
    if (memberId && input.registerUser) {
      res.status(400).json({ success: false, message: 'Signed-in users must omit registerUser' }); return;
    }
    rentalSchema.parse(input);
    const car = await prisma.car.findUnique({ where: { id: input.carId } });
    if (!car) { res.status(404).json({ success: false, message: 'Car not found' }); return; }
    if (!car.isAvailable) { res.status(409).json({ success: false, message: 'Car is unavailable' }); return; }
    const pricing = calculateCarRentalPrice({
      ...input, hourlyRate: Number(car.hourlyRate), dailyRate: Number(car.dailyRate),
    });
    const newUserData = input.registerUser ? await registrationData(input.registerUser) : undefined;
    // Roll back registration as well if creating the booking fails.
    const booking = await prisma.$transaction(async (tx) => {
      const userId = memberId ?? (await tx.user.create({ data: newUserData! })).id;
      return tx.booking.create({
        data: {
          userId, carId: car.id,
          startDateTime: new Date(input.startDateTime), endDateTime: new Date(input.endDateTime),
          calculatedDays: pricing.days, calculatedHours: pricing.hours,
          totalPrice: pricing.totalPrice, pricingDetails: { breakdown: pricing.breakdown },
          hourlyRate: car.hourlyRate, dailyRate: car.dailyRate, currencyCode: car.currencyCode,
          status: 'PENDING', source: newUserData ? 'REGISTER_AND_BOOK' : 'EXISTING_MEMBER',
        },
        include: { car: true, user: { select: { id: true, name: true, email: true } } },
      });
    });
    res.status(201).json({ success: true, data: booking });
  } catch (error) { next(error); }
});

router.patch('/:id/status', requireJson, requireAdmin, async (req, res, next) => {
  try {
    const input = z.object({
      status: z.nativeEnum(BookingStatus), adminNote: z.string().trim().max(2000).optional(),
    }).strict().parse(req.body);
    const booking = await prisma.booking.update({
      where: { id: req.params.id },
      data: {
        ...input, approvedById: res.locals.session.user.id, reviewedAt: new Date(),
      },
    });
    res.json({ success: true, data: booking });
  } catch (error) { next(error); }
});

export default router;
