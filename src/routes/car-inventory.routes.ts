import { Router, type NextFunction, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { databasePool, queryOne, required, withTransaction } from "../lib/db.js";
import { insertRows, updateRows } from "../lib/db-write.js";
import {
  carsByIds, carSchedule, catalogOffers, destinationOffers, findCar, findLocation, findModel, findOffer, hasReservations,
  listInventory, listModels, lockCar, lockCarInventory, searchOffers,
} from "../lib/inventory-queries.js";
import { carInputSchema } from "../lib/car-input.js";
import { requireAdmin, requireJson } from "../middleware/auth.js";
import { canSchedule, legacyValues, reservedStatuses } from "../lib/car-inventory.js";
import { formatCar } from "../lib/car-format.js";
import { calculateCarRentalPrice } from "../utils/pricing.js";
import { carState, resolveOperationalStatus } from "../lib/car-state.js";

const router = Router();
const modelSchema = carInputSchema
  .omit({
    licensePlate: true,
    country: true,
    hourlyRate: true,
    dailyRate: true,
    locationId: true,
    providerName: true,
    isAvailable: true,
  })
  .extend({
    description: z.string().trim().max(4000).optional(),
    imageUrl: z.string().url().max(2000).nullable().optional(),
  });
const offerSchema = z
  .object({
    carModelId: z.string().min(1),
    locationId: z.string().min(1),
    providerName: z.string().trim().min(1).max(150),
    hourlyRate: carInputSchema.shape.hourlyRate,
    dailyRate: carInputSchema.shape.dailyRate,
    isActive: z.boolean(),
    turnaroundMinutes: z.number().int().min(0).max(1440),
  })
  .strict();
const inventorySchema = z
  .object({
    carModelLocationId: z.string().min(1),
    licensePlate: carInputSchema.shape.licensePlate,
    year: carInputSchema.shape.year,
    isAvailable: z.boolean(),
    transfer: z.boolean().optional(),
    transferNote: z.string().trim().max(1000).optional(),
    operationalStatus: z
      .enum(["AVAILABLE", "CLEANING", "MAINTENANCE", "INACTIVE"])
      .optional(),
    exteriorColor: z.string().trim().max(100).nullable().optional(),
    odometerKm: z.number().int().min(0).max(2147483647).nullable().optional(),
    vin: z.string().trim().min(1).max(50).nullable().optional(),
  })
  .strict();
const validStatus = (value: {
  isAvailable: boolean;
  operationalStatus?: string;
}) =>
  !value.operationalStatus ||
  value.isAvailable === (value.operationalStatus === "AVAILABLE");
const bulkInventorySchema = inventorySchema
  .omit({ licensePlate: true, transfer: true, transferNote: true, vin: true })
  .extend({
    licensePlates: z
      .array(carInputSchema.shape.licensePlate)
      .min(1)
      .max(100)
      .refine((plates) => new Set(plates).size === plates.length, {
        message: "License plates must be unique",
      }),
  })
  .refine(validStatus, {
    message: "Service flag and vehicle status must match",
  });

router.get("/search", async (req, res, next) => {
  try {
    const input = z
      .object({
        country: z.string().optional(),
        locationId: z.string().min(1).optional(),
        dropoffLocationId: z.string().min(1).optional(),
        startDateTime: z.string().datetime({ offset: true }).optional(),
        endDateTime: z.string().datetime({ offset: true }).optional(),
      })
      .refine((v) => Boolean(v.startDateTime) === Boolean(v.endDateTime))
      .refine(
        (v) =>
          !v.startDateTime ||
          new Date(v.endDateTime!) > new Date(v.startDateTime),
      )
      .parse(req.query);
    const db = databasePool();
    if (
      input.locationId &&
      !(await findLocation(db, input.locationId))
    ) {
      res
        .status(400)
        .json({ success: false, message: "Invalid pickup location" });
      return;
    }
    const dropoff = input.dropoffLocationId
      ? await findLocation(db, input.dropoffLocationId)
      : null;
    if (input.dropoffLocationId && !dropoff) {
      res
        .status(400)
        .json({ success: false, message: "Invalid dropoff location" });
      return;
    }
    const offers = await searchOffers(db, input.locationId ?? null,
      input.country && input.country !== "all" ? input.country.toUpperCase() : null);
    const cars = await listInventory(db, true);
    const destinations = dropoff ? await destinationOffers(db, dropoff.id) : [];
    const data = offers.flatMap((offer) => {
      if (dropoff && dropoff.countryCode !== offer.location.countryCode)
        return [];
      if (
        dropoff &&
        dropoff.id !== offer.locationId &&
        !destinations.some(
          (destination) =>
            destination.carModelId === offer.carModelId &&
            destination.providerName === offer.providerName,
        )
      )
        return [];
      const availableCount = cars.filter((car) => {
        if (
          car.country !== offer.location.countryCode ||
          car.carModelLocation?.carModelId !== offer.carModelId ||
          car.carModelLocation.providerName !== offer.providerName
        )
          return false;
        return input.startDateTime
          ? canSchedule(
              car.locationId,
              car.bookings,
              {
                startDateTime: new Date(input.startDateTime),
                endDateTime: new Date(input.endDateTime!),
                pickupLocationId: offer.locationId,
                dropoffLocationId: dropoff?.id || offer.locationId,
                turnaroundMinutes: offer.turnaroundMinutes,
              },
              car.availableFrom,
            )
          : car.locationId === offer.locationId &&
              (!car.availableFrom || car.availableFrom <= new Date()) &&
              !car.bookings.some(
                (booking) => booking.startDateTime <= new Date(),
              );
      }).length;
      if (!availableCount) return [];
      const price = input.startDateTime
        ? calculateCarRentalPrice({
            startDateTime: input.startDateTime,
            endDateTime: input.endDateTime!,
            hourlyRate: Number(offer.hourlyRate),
            dailyRate: Number(offer.dailyRate),
            timeZone: offer.location.timeZone,
          })
        : null;
      return [
        {
          ...formatCar({
            ...offer.carModel,
            ...offer,
            model: offer.carModel.model,
            brand: offer.carModel.brand,
            ...legacyValues(offer),
            location: offer.location,
            countryInfo: offer.location.country,
            isAvailable: true,
          }),
          id: offer.id,
          carModelId: offer.carModelId,
          carModelLocationId: offer.id,
          availableCount,
          availabilityChecked: Boolean(input.startDateTime),
          licensePlate: undefined,
          quotedTotal: price?.totalPrice,
          quotedDays: price?.days,
          quotedHours: price?.hours,
        },
      ];
    });
    res
      .set("Cache-Control", "no-store")
      .json({ success: true, count: data.length, data });
  } catch (error) {
    next(error);
  }
});

router.get("/catalog", requireAdmin, async (_req, res, next) => {
  try {
    const now = new Date();
    const [models, offers, inventory] = await withTransaction(async (tx) => {
      const models = await listModels(tx);
      const offers = await catalogOffers(tx);
      const inventory = await listInventory(tx);
      return [models, offers, inventory] as const;
    }, { repeatableRead: true });
    const units = inventory.map((car) => {
      const currentOffers = offers.filter(
        (offer) =>
          offer.locationId === car.locationId &&
          offer.carModelId === car.carModelLocation?.carModelId &&
          offer.providerName === car.carModelLocation?.providerName,
      );
      const currentOffer =
        currentOffers.find((offer) => offer.id === car.carModelLocationId) ??
        currentOffers.find((offer) => offer.isActive) ??
        currentOffers[0];
      const state = carState(car, now);
      return {
        ...formatCar(car),
        rawModel: car.carModelLocation?.carModel.model ?? car.model,
        year: car.year,
        ...state,
        inventoryStatus:
          state.inventoryStatus === "AVAILABLE" &&
          !currentOffers.some((offer) => offer.isActive)
            ? "INACTIVE"
            : state.inventoryStatus,
        featureCodes:
          car.carModelLocation?.carModel.featureCodes ?? car.featureCodes,
        options: car.carModelLocation?.carModel.options ?? car.options,
        // A one-way return uses the rates offered at the current physical branch.
        ...(currentOffer
          ? {
              hour: Number(currentOffer.hourlyRate),
              day: Number(currentOffer.dailyRate),
              hourlyRate: currentOffer.hourlyRate,
              dailyRate: currentOffer.dailyRate,
            }
          : {}),
        homeLocationId: car.carModelLocation?.locationId ?? null,
      };
    });
    const offerMap = new Map(offers.map((offer) => [offer.id, offer]));
    const locationInventory = new Map<
      string,
      { locationId: string; totalCars: number; activeCars: number }
    >();
    for (const car of inventory) {
      if (!car.locationId) continue;
      const count = locationInventory.get(car.locationId) ?? {
        locationId: car.locationId,
        totalCars: 0,
        activeCars: 0,
      };
      count.totalCars++;
      if (car.isAvailable) count.activeCars++;
      locationInventory.set(car.locationId, count);
    }
    res.set("Cache-Control", "no-store").json({
      success: true,
      data: {
        units,
        summary: {
          models: models.length,
          locations: new Set(
            offers
              .filter((offer) => offer.isActive)
              .map((offer) => offer.locationId),
          ).size,
          countries: new Set(
            offers
              .filter((offer) => offer.isActive)
              .map((offer) => offer.location.countryCode),
          ).size,
          total: units.length,
          available: units.filter((unit) => unit.inventoryStatus === "AVAILABLE")
            .length,
          inUse: units.filter((unit) => unit.rentalStatus === "IN_USE").length,
          maintenance: units.filter(
            (unit) => unit.inventoryStatus === "MAINTENANCE",
          ).length,
        },
        generatedAt: now.toISOString(),
        models: models.map((model) => {
          const cars = inventory.filter(
            (car) =>
              car.carModelLocationId &&
              offerMap.get(car.carModelLocationId)?.carModelId === model.id,
          );
          return {
            ...model,
            totalCars: cars.length,
            locationCount: new Set(
              cars.map((car) => car.locationId).filter(Boolean),
            ).size,
          };
        }),
        offers: offers.map((offer) => ({
          ...offer,
          inventoryCount: inventory.filter((car) => {
            const home = car.carModelLocationId
              ? offerMap.get(car.carModelLocationId)
              : null;
            return (
              car.locationId === offer.locationId &&
              home?.carModelId === offer.carModelId &&
              home.providerName === offer.providerName
            );
          }).length,
        })),
        locationInventory: [...locationInventory.values()],
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/models", requireJson, requireAdmin, async (req, res, next) => {
  try {
    const data = modelSchema.parse(req.body);
    const model = await withTransaction(async (tx) => {
      await lockCarInventory(tx);
      const [created] = await insertRows(tx, "car_models", [data]);
      return required(await findModel(tx, created.id));
    });
    res.status(201).json({ success: true, data: model });
  } catch (error) {
    next(error);
  }
});
router.patch(
  "/models/:id",
  requireJson,
  requireAdmin,
  async (req, res, next) => {
    try {
      const { imageUrl, ...data } = modelSchema.parse(req.body);
      const model = await withTransaction(async (tx) => {
        await lockCarInventory(tx);
        if (!(await findModel(tx, req.params.id)))
          return null;
        // Booked specifications stay fixed until outstanding journeys are resolved.
        if (
          await queryOne(tx, `SELECT b.id FROM bookings b
            JOIN cars c ON c.id = b."carId"
            JOIN car_model_locations o ON o.id = c."carModelLocationId"
            WHERE o."carModelId" = $1 AND b.status = ANY($2::"BookingStatus"[]) LIMIT 1`,
            [req.params.id, reservedStatuses])
        )
          throw new Error("HAS_ACTIVE_BOOKINGS");
        await updateRows(tx, "car_models", { ...data, imageUrl }, { id: req.params.id });
        await updateRows(tx, "cars", data, { modelId: req.params.id });
        return required(await findModel(tx, req.params.id));
      });
      if (!model) {
        res.status(404).json({ success: false, message: "Model not found" });
        return;
      }
      res.json({ success: true, data: model });
    } catch (error) {
      next(error);
    }
  },
);

router.post("/offers", requireJson, requireAdmin, async (req, res, next) => {
  try {
    const data = offerSchema.parse(req.body);
    const offer = await withTransaction(async (tx) => {
      await lockCarInventory(tx);
      if (
        !(await findModel(tx, data.carModelId)) ||
        !(await findLocation(tx, data.locationId))
      )
        return null;
      const [created] = await insertRows(tx, "car_model_locations", [data]);
      return required(await findOffer(tx, created.id));
    });
    if (!offer) {
      res
        .status(400)
        .json({ success: false, message: "Invalid model or location" });
      return;
    }
    res.status(201).json({ success: true, data: offer });
  } catch (error) {
    next(error);
  }
});
router.patch(
  "/offers/:id",
  requireJson,
  requireAdmin,
  async (req, res, next) => {
    try {
      const data = offerSchema.parse(req.body);
      const offer = await withTransaction(async (tx) => {
        await lockCarInventory(tx);
        const old = await findOffer(tx, req.params.id);
        if (!old) return null;
        // Identity is immutable: create a new branch offer, then transfer individual cars.
        if (
          old.carModelId !== data.carModelId ||
          old.locationId !== data.locationId ||
          old.providerName !== data.providerName
        ) {
          throw new Error("OFFER_IDENTITY");
        }
        await updateRows(tx, "car_model_locations", data, { id: old.id });
        const updated = required(await findOffer(tx, old.id));
        await updateRows(tx, "cars", {
          hourlyRate: updated.hourlyRate,
          dailyRate: updated.dailyRate,
        }, { offerId: old.id });
        return updated;
      });
      if (!offer) {
        res.status(404).json({ success: false, message: "Offer not found" });
        return;
      }
      res.json({ success: true, data: offer });
    } catch (error) {
      next(error);
    }
  },
);

// One transaction: a duplicate registration rejects the entire batch.
router.post("/bulk", requireJson, requireAdmin, async (req, res, next) => {
  try {
    const input = bulkInventorySchema.parse(req.body);
    const cars = await withTransaction(async (tx) => {
      await lockCarInventory(tx);
      const offer = await findOffer(tx, input.carModelLocationId);
      if (!offer || input.year !== offer.carModel.year) return null;
      const rows = input.licensePlates.map((licensePlate) => ({
        ...legacyValues(offer),
        id: randomUUID(),
        carModelLocationId: offer.id,
        locationId: offer.locationId,
        year: input.year,
        licensePlate,
        isAvailable: input.isAvailable,
        operationalStatus: resolveOperationalStatus(input.isAvailable, input.operationalStatus),
        exteriorColor: input.exteriorColor,
        odometerKm: input.odometerKm,
      }));
      await insertRows(tx, "cars", rows);
      const saved = await carsByIds(tx, rows.map(({ id }) => id));
      const byId = new Map(saved.map((car) => [car.id, car]));
      return rows.map(({ id }) => required(byId.get(id) ?? null));
    });
    if (!cars) {
      res.status(400).json({ success: false, message: "Invalid offer" });
      return;
    }
    res
      .status(201)
      .json({ success: true, count: cars.length, data: cars.map(formatCar) });
  } catch (error) {
    next(error);
  }
});

export async function createInventoryCar(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const input = inventorySchema.refine(validStatus).parse(req.body);
    const { transfer: _transfer, transferNote: _note, ...values } = input;
    const car = await withTransaction(async (tx) => {
      await lockCarInventory(tx);
      const offer = await findOffer(tx, input.carModelLocationId);
      if (!offer || input.year !== offer.carModel.year) return null;
      const [created] = await insertRows(tx, "cars", [{
        ...legacyValues(offer),
        ...values,
        operationalStatus: resolveOperationalStatus(input.isAvailable, input.operationalStatus),
        locationId: offer.locationId,
      }]);
      return required(await findCar(tx, created.id));
    });
    if (!car) {
      res.status(400).json({ success: false, message: "Invalid offer" });
      return;
    }
    res.status(201).json({ success: true, data: formatCar(car) });
  } catch (error) {
    next(error);
  }
}

export async function updateInventoryCar(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const input = inventorySchema.refine(validStatus).parse(req.body);
    const { transfer, transferNote, ...values } = input;
    const car = await withTransaction(async (tx) => {
      await lockCarInventory(tx);
      await lockCar(tx, req.params.id);
      const old = await findCar(tx, req.params.id);
      if (!old) return null;
      const offer = await findOffer(tx, input.carModelLocationId);
      if (!offer || input.year !== offer.carModel.year)
        throw new Error("INVALID_OFFER");
      const moving = old.carModelLocationId !== offer.id || transfer === true;
      const operationalStatus = resolveOperationalStatus(
        input.isAvailable,
        input.operationalStatus,
        old.operationalStatus,
      );
      if (
        old.isAvailable &&
        !input.isAvailable &&
        (await hasReservations(tx, old.id))
      ) {
        throw new Error("HAS_ACTIVE_BOOKINGS");
      }
      if (moving) {
        if (
          transfer &&
          (!offer.isActive ||
            !old.carModelLocation ||
            old.carModelLocation.carModelId !== offer.carModelId ||
            old.carModelLocation.providerName !== offer.providerName ||
            old.country !== offer.location.countryCode)
        )
          throw new Error("INVALID_TRANSFER");
        if (
          await hasReservations(tx, old.id)
        )
          throw new Error("HAS_ACTIVE_BOOKINGS");
        if (old.locationId !== offer.locationId)
          await insertRows(tx, "car_movements", [{
            carId: old.id,
            fromLocationId: old.locationId,
            toLocationId: offer.locationId,
            reason: "ADMIN_TRANSFER",
            note: transferNote || null,
          }]);
      }
      await updateRows(tx, "cars", {
        ...legacyValues(offer),
        ...values,
        operationalStatus,
        locationId: moving ? offer.locationId : old.locationId,
        ...(moving ? { availableFrom: null } : {}),
      }, { id: old.id });
      return required(await findCar(tx, old.id));
    });
    if (!car) {
      res.status(404).json({ success: false, message: "Car not found" });
      return;
    }
    res.json({ success: true, data: formatCar(car) });
  } catch (error) {
    next(error);
  }
}

router.get("/:id/schedule", requireAdmin, async (req, res, next) => {
  try {
    const car = await withTransaction((tx) => carSchedule(tx, req.params.id), { repeatableRead: true });
    if (!car) {
      res.status(404).json({ success: false, message: "Car not found" });
      return;
    }
    res.set("Cache-Control", "no-store").json({ success: true, data: car });
  } catch (error) {
    next(error);
  }
});

export default router;
