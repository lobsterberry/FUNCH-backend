import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { carInputSchema } from '../lib/car-input.js';
import { requireAdmin, requireJson } from '../middleware/auth.js';
import { canSchedule, inventoryInclude, legacyValues, lockFleet, offerInclude, reservedStatuses } from '../lib/fleet.js';
import { formatCar } from './car.routes.js';
import { calculateCarRentalPrice } from '../utils/pricing.js';
import { fleetState, inventoryStatus } from '../lib/fleet-state.js';

const router = Router();
const modelSchema = carInputSchema.omit({ licensePlate: true, country: true, hourlyRate: true, dailyRate: true,
  locationId: true, providerName: true, isAvailable: true }).extend({
  description: z.string().trim().max(4000).optional(),
  imageUrl: z.string().url().max(2000).nullable().optional(),
});
const offerSchema = z.object({
  carModelId: z.string().min(1), locationId: z.string().min(1),
  providerName: z.string().trim().min(1).max(150),
  hourlyRate: carInputSchema.shape.hourlyRate, dailyRate: carInputSchema.shape.dailyRate,
  isActive: z.boolean(), turnaroundMinutes: z.number().int().min(0).max(1440),
}).strict();
const inventorySchema = z.object({
  carModelLocationId: z.string().min(1), licensePlate: carInputSchema.shape.licensePlate,
  year: carInputSchema.shape.year, isAvailable: z.boolean(),
  transfer: z.boolean().optional(),
  transferNote: z.string().trim().max(1000).optional(),
  operationalStatus: z.enum(['AVAILABLE', 'CLEANING', 'MAINTENANCE', 'INACTIVE']).optional(),
  exteriorColor: z.string().trim().max(100).nullable().optional(),
  odometerKm: z.number().int().min(0).max(2147483647).nullable().optional(),
  vin: z.string().trim().min(1).max(50).nullable().optional(),
}).strict();
const validStatus = (value: { isAvailable: boolean; operationalStatus?: string }) =>
  !value.operationalStatus || value.isAvailable === (value.operationalStatus === 'AVAILABLE');
const bulkInventorySchema = inventorySchema.omit({ licensePlate: true, transfer: true, transferNote: true, vin: true }).extend({
  licensePlates: z.array(carInputSchema.shape.licensePlate).min(1).max(100)
    .refine((plates) => new Set(plates).size === plates.length, { message: 'License plates must be unique' }),
}).refine(validStatus, { message: 'Service flag and vehicle status must match' });

router.get('/search', async (req, res, next) => {
  try {
    const input = z.object({
      country: z.string().optional(), locationId: z.string().min(1).optional(),
      dropoffLocationId: z.string().min(1).optional(),
      startDateTime: z.string().datetime({ offset: true }).optional(),
      endDateTime: z.string().datetime({ offset: true }).optional(),
    }).refine((v) => Boolean(v.startDateTime) === Boolean(v.endDateTime))
      .refine((v) => !v.startDateTime || new Date(v.endDateTime!) > new Date(v.startDateTime)).parse(req.query);
    if (input.locationId && !await prisma.location.findUnique({ where: { id: input.locationId } })) {
      res.status(400).json({ success: false, message: 'Invalid pickup location' }); return;
    }
    const dropoff = input.dropoffLocationId ? await prisma.location.findUnique({ where: { id: input.dropoffLocationId } }) : null;
    if (input.dropoffLocationId && !dropoff) {
      res.status(400).json({ success: false, message: 'Invalid dropoff location' }); return;
    }
    const offers = await prisma.carModelLocation.findMany({ where: {
      isActive: true, ...(input.locationId ? { locationId: input.locationId } : {}),
      ...(input.country && input.country !== 'all' ? { location: { countryCode: input.country.toUpperCase() } } : {}),
    }, include: offerInclude, orderBy: [{ carModel: { isFeatured: 'desc' } }, { carModel: { recommendationOrder: 'asc' } }, { id: 'asc' }] });
    const cars = await prisma.car.findMany({ where: { isAvailable: true, operationalStatus: 'AVAILABLE', carModelLocationId: { not: null } },
      include: { carModelLocation: true, bookings: { where: { status: { in: [...reservedStatuses] } } } } });
    const destinations = dropoff ? await prisma.carModelLocation.findMany({ where: { locationId: dropoff.id, isActive: true }, select: { carModelId: true, providerName: true } }) : [];
    const data = offers.flatMap((offer) => {
      if (dropoff && dropoff.countryCode !== offer.location.countryCode) return [];
      if (dropoff && dropoff.id !== offer.locationId && !destinations.some((destination) => destination.carModelId === offer.carModelId && destination.providerName === offer.providerName)) return [];
      const availableCount = cars.filter((car) => {
        if (car.country !== offer.location.countryCode || car.carModelLocation?.carModelId !== offer.carModelId ||
          car.carModelLocation.providerName !== offer.providerName) return false;
        return input.startDateTime ? canSchedule(car.locationId, car.bookings, {
          startDateTime: new Date(input.startDateTime), endDateTime: new Date(input.endDateTime!),
          pickupLocationId: offer.locationId, dropoffLocationId: dropoff?.id || offer.locationId,
          turnaroundMinutes: offer.turnaroundMinutes,
        }, car.availableFrom) : car.locationId === offer.locationId &&
          (!car.availableFrom || car.availableFrom <= new Date()) && !car.bookings.some((booking) => booking.startDateTime <= new Date());
      }).length;
      if (!availableCount) return [];
      const price = input.startDateTime ? calculateCarRentalPrice({ startDateTime: input.startDateTime,
        endDateTime: input.endDateTime!, hourlyRate: Number(offer.hourlyRate), dailyRate: Number(offer.dailyRate), timeZone: offer.location.timeZone }) : null;
      return [{ ...formatCar({ ...offer.carModel, ...offer, model: offer.carModel.model, brand: offer.carModel.brand,
        ...legacyValues(offer), location: offer.location, countryInfo: offer.location.country, isAvailable: true }),
        id: offer.id, carModelId: offer.carModelId, carModelLocationId: offer.id,
        availableCount, availabilityChecked: Boolean(input.startDateTime), licensePlate: undefined,
        quotedTotal: price?.totalPrice, quotedDays: price?.days, quotedHours: price?.hours,
      }];
    });
    res.set('Cache-Control', 'no-store').json({ success: true, count: data.length, data });
  } catch (error) { next(error); }
});

router.get('/catalog', requireAdmin, async (_req, res, next) => {
  try {
    const now = new Date();
    const [models, offers, inventory] = await prisma.$transaction([
      prisma.carModel.findMany({ orderBy: [{ brand: 'asc' }, { model: 'asc' }] }),
      prisma.carModelLocation.findMany({ include: { ...offerInclude, _count: { select: { cars: true } } }, orderBy: { createdAt: 'asc' } }),
      prisma.car.findMany({ include: { ...inventoryInclude,
        bookings: { where: { status: { in: [...reservedStatuses] } },
          select: { status: true, startDateTime: true, endDateTime: true } },
      }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const units = inventory.map((car) => {
      const currentOffers = offers.filter((offer) => offer.locationId === car.locationId &&
        offer.carModelId === car.carModelLocation?.carModelId && offer.providerName === car.carModelLocation?.providerName);
      const currentOffer = currentOffers.find((offer) => offer.id === car.carModelLocationId) ?? currentOffers.find((offer) => offer.isActive) ?? currentOffers[0];
      const state = fleetState(car, now);
      return { ...formatCar(car), rawModel: car.carModelLocation?.carModel.model ?? car.model,
        year: car.year, ...state,
        fleetStatus: state.fleetStatus === 'AVAILABLE' && !currentOffers.some((offer) => offer.isActive) ? 'INACTIVE' : state.fleetStatus,
        featureCodes: car.carModelLocation?.carModel.featureCodes ?? car.featureCodes,
        options: car.carModelLocation?.carModel.options ?? car.options,
        // A one-way return uses the rates offered at the current physical branch.
        ...(currentOffer ? { hour: Number(currentOffer.hourlyRate), day: Number(currentOffer.dailyRate),
          hourlyRate: currentOffer.hourlyRate, dailyRate: currentOffer.dailyRate } : {}),
        homeLocationId: car.carModelLocation?.locationId ?? null,
      };
    });
    const offerMap = new Map(offers.map((offer) => [offer.id, offer]));
    const locationInventory = new Map<string, { locationId: string; totalCars: number; activeCars: number }>();
    for (const car of inventory) {
      if (!car.locationId) continue;
      const count = locationInventory.get(car.locationId) ?? { locationId: car.locationId, totalCars: 0, activeCars: 0 };
      count.totalCars++; if (car.isAvailable) count.activeCars++;
      locationInventory.set(car.locationId, count);
    }
    res.set('Cache-Control', 'no-store').json({ success: true, data: {
      units,
      summary: { models: models.length, locations: new Set(offers.filter((offer) => offer.isActive).map((offer) => offer.locationId)).size,
        countries: new Set(offers.filter((offer) => offer.isActive).map((offer) => offer.location.countryCode)).size,
        total: units.length, available: units.filter((unit) => unit.fleetStatus === 'AVAILABLE').length,
        inUse: units.filter((unit) => unit.rentalStatus === 'IN_USE').length,
        maintenance: units.filter((unit) => unit.fleetStatus === 'MAINTENANCE').length,
      },
      generatedAt: now.toISOString(),
      models: models.map((model) => {
        const cars = inventory.filter((car) => car.carModelLocationId && offerMap.get(car.carModelLocationId)?.carModelId === model.id);
        return { ...model, totalCars: cars.length, locationCount: new Set(cars.map((car) => car.locationId).filter(Boolean)).size };
      }),
      offers: offers.map((offer) => ({ ...offer, inventoryCount: inventory.filter((car) => {
        const home = car.carModelLocationId ? offerMap.get(car.carModelLocationId) : null;
        return car.locationId === offer.locationId && home?.carModelId === offer.carModelId && home.providerName === offer.providerName;
      }).length })),
      locationInventory: [...locationInventory.values()],
    } });
  } catch (error) { next(error); }
});

router.post('/models', requireJson, requireAdmin, async (req, res, next) => {
  try {
    const data = modelSchema.parse(req.body);
    const model = await prisma.$transaction(async (tx) => { await lockFleet(tx); return tx.carModel.create({ data }); });
    res.status(201).json({ success: true, data: model });
  } catch (error) { next(error); }
});
router.patch('/models/:id', requireJson, requireAdmin, async (req, res, next) => {
  try {
    const data = modelSchema.parse(req.body);
    const model = await prisma.$transaction(async (tx) => {
      await lockFleet(tx);
      if (!await tx.carModel.findUnique({ where: { id: req.params.id } })) return null;
      // Booked specifications stay fixed until outstanding journeys are resolved.
      if (await tx.booking.findFirst({ where: { status: { in: [...reservedStatuses] },
        car: { carModelLocation: { carModelId: req.params.id } } } })) throw new Error('FLEET_BOOKED');
      const updated = await tx.carModel.update({ where: { id: req.params.id }, data });
      await tx.car.updateMany({ where: { carModelLocation: { carModelId: updated.id } }, data });
      return updated;
    });
    if (!model) { res.status(404).json({ success: false, message: 'Model not found' }); return; }
    res.json({ success: true, data: model });
  } catch (error) { next(error); }
});

router.post('/offers', requireJson, requireAdmin, async (req, res, next) => {
  try {
    const data = offerSchema.parse(req.body);
    const offer = await prisma.$transaction(async (tx) => {
      await lockFleet(tx);
      if (!await tx.carModel.findUnique({ where: { id: data.carModelId } }) ||
        !await tx.location.findUnique({ where: { id: data.locationId } })) return null;
      return tx.carModelLocation.create({ data, include: offerInclude });
    });
    if (!offer) { res.status(400).json({ success: false, message: 'Invalid model or location' }); return; }
    res.status(201).json({ success: true, data: offer });
  } catch (error) { next(error); }
});
router.patch('/offers/:id', requireJson, requireAdmin, async (req, res, next) => {
  try {
    const data = offerSchema.parse(req.body);
    const offer = await prisma.$transaction(async (tx) => {
      await lockFleet(tx);
      const old = await tx.carModelLocation.findUnique({ where: { id: req.params.id } });
      if (!old) return null;
      // Identity is immutable: create a new branch offer, then transfer individual cars.
      if (old.carModelId !== data.carModelId || old.locationId !== data.locationId || old.providerName !== data.providerName) {
        throw new Error('OFFER_IDENTITY');
      }
      const updated = await tx.carModelLocation.update({ where: { id: old.id }, data, include: offerInclude });
      await tx.car.updateMany({ where: { carModelLocationId: old.id }, data: {
        hourlyRate: updated.hourlyRate, dailyRate: updated.dailyRate,
      } });
      return updated;
    });
    if (!offer) { res.status(404).json({ success: false, message: 'Offer not found' }); return; }
    res.json({ success: true, data: offer });
  } catch (error) { next(error); }
});

// One transaction: a duplicate registration rejects the entire batch.
router.post('/cars/bulk', requireJson, requireAdmin, async (req, res, next) => {
  try {
    const input = bulkInventorySchema.parse(req.body);
    const cars = await prisma.$transaction(async (tx) => {
      await lockFleet(tx);
      const offer = await tx.carModelLocation.findUnique({ where: { id: input.carModelLocationId }, include: offerInclude });
      if (!offer || input.year !== offer.carModel.year) return null;
      const rows = input.licensePlates.map((licensePlate) => ({ ...legacyValues(offer),
        id: randomUUID(), carModelLocationId: offer.id, locationId: offer.locationId,
        year: input.year, licensePlate, isAvailable: input.isAvailable,
        operationalStatus: inventoryStatus(input.isAvailable, input.operationalStatus),
        exteriorColor: input.exteriorColor, odometerKm: input.odometerKm,
      } as Prisma.CarCreateManyInput));
      await tx.car.createMany({ data: rows });
      const saved = await tx.car.findMany({ where: { id: { in: rows.map((row) => row.id!) } }, include: inventoryInclude });
      const byId = new Map(saved.map((car) => [car.id, car]));
      return rows.map((row) => byId.get(row.id!)!);
    });
    if (!cars) { res.status(400).json({ success: false, message: 'Invalid offer' }); return; }
    res.status(201).json({ success: true, count: cars.length, data: cars.map(formatCar) });
  } catch (error) { next(error); }
});

router.post('/cars', requireJson, requireAdmin, async (req, res, next) => {
  try {
    const input = inventorySchema.refine(validStatus).parse(req.body);
    const { transfer: _transfer, transferNote: _note, ...values } = input;
    const car = await prisma.$transaction(async (tx) => {
      await lockFleet(tx);
      const offer = await tx.carModelLocation.findUnique({ where: { id: input.carModelLocationId }, include: offerInclude });
      if (!offer || input.year !== offer.carModel.year) return null;
      return tx.car.create({ data: { ...legacyValues(offer), ...values,
        operationalStatus: inventoryStatus(input.isAvailable, input.operationalStatus), locationId: offer.locationId } as Prisma.CarUncheckedCreateInput,
        include: inventoryInclude });
    });
    if (!car) { res.status(400).json({ success: false, message: 'Invalid offer' }); return; }
    res.status(201).json({ success: true, data: formatCar(car) });
  } catch (error) { next(error); }
});
router.patch('/cars/:id', requireJson, requireAdmin, async (req, res, next) => {
  try {
    const input = inventorySchema.refine(validStatus).parse(req.body);
    const { transfer, transferNote, ...values } = input;
    const car = await prisma.$transaction(async (tx) => {
      await lockFleet(tx);
      await tx.$queryRaw`SELECT id FROM cars WHERE id = ${req.params.id} FOR UPDATE`;
      const old = await tx.car.findUnique({ where: { id: req.params.id }, include: { carModelLocation: true } });
      if (!old) return null;
      const offer = await tx.carModelLocation.findUnique({ where: { id: input.carModelLocationId }, include: offerInclude });
      if (!offer || input.year !== offer.carModel.year) throw new Error('INVALID_OFFER');
      const moving = old.carModelLocationId !== offer.id || transfer === true;
      const operationalStatus = inventoryStatus(input.isAvailable, input.operationalStatus, old.operationalStatus);
      if (old.isAvailable && !input.isAvailable && await tx.booking.findFirst({ where: { carId: old.id, status: { in: [...reservedStatuses] } } })) {
        throw new Error('FLEET_BOOKED');
      }
      if (moving) {
        if (transfer && (!offer.isActive || !old.carModelLocation ||
          old.carModelLocation.carModelId !== offer.carModelId || old.carModelLocation.providerName !== offer.providerName ||
          old.country !== offer.location.countryCode)) throw new Error('INVALID_TRANSFER');
        if (await tx.booking.findFirst({ where: { carId: old.id, status: { in: [...reservedStatuses] } } })) throw new Error('FLEET_BOOKED');
        if (old.locationId !== offer.locationId) await tx.carMovement.create({ data: {
          carId: old.id, fromLocationId: old.locationId, toLocationId: offer.locationId, reason: 'ADMIN_TRANSFER', note: transferNote || null,
        } });
      }
      return tx.car.update({ where: { id: old.id }, data: {
        ...legacyValues(offer), ...values, operationalStatus, locationId: moving ? offer.locationId : old.locationId,
        ...(moving ? { availableFrom: null } : {}),
      }, include: inventoryInclude });
    });
    if (!car) { res.status(404).json({ success: false, message: 'Car not found' }); return; }
    res.json({ success: true, data: formatCar(car) });
  } catch (error) { next(error); }
});

router.get('/cars/:id/schedule', requireAdmin, async (req, res, next) => {
  try {
    const car = await prisma.car.findUnique({ where: { id: req.params.id }, include: {
      location: true, movements: { orderBy: { occurredAt: 'desc' }, include: { fromLocation: true, toLocation: true } },
      bookings: { orderBy: { startDateTime: 'asc' }, select: {
        id: true, bookingNumber: true, status: true, startDateTime: true, endDateTime: true,
        pickupLocation: true, dropoffLocation: true, turnaroundMinutes: true,
      } },
    } });
    if (!car) { res.status(404).json({ success: false, message: 'Car not found' }); return; }
    res.set('Cache-Control', 'no-store').json({ success: true, data: car });
  } catch (error) { next(error); }
});

export default router;
