import { Router, Request, Response } from "express";
import { isDeepStrictEqual } from "node:util";
import { databasePool, queryOne, queryRows, required, withTransaction } from "../lib/db.js";
import { insertRows, updateRows } from "../lib/db-write.js";
import {
  attachLegacyCar, findCar, hasReservations, listInventory, listPublicCars, lockCar,
  lockCarInventory, publicCar, type Specification,
} from "../lib/inventory-queries.js";
import { requireAdmin, requireJson } from "../middleware/auth.js";
import { carInputSchema } from "../lib/car-input.js";
import { effectiveCar, modelData } from "../lib/car-inventory.js";
import { carState, resolveOperationalStatus } from "../lib/car-state.js";
import { formatCar } from "../lib/car-format.js";
import carInventoryRoutes, {
  createInventoryCar,
  updateInventoryCar,
} from "./car-inventory.routes.js";

const router = Router();
router.use(carInventoryRoutes);

// GET /api/cars/meta - ดึงข้อมูล category, fuel, features ที่มีอยู่ในฐานข้อมูล
router.get("/meta", async (_req: Request, res: Response) => {
  try {
    const cars = await queryRows<Pick<Specification, "categories" | "categoryLabel" | "fuelType" | "options">>(
      databasePool(), 'SELECT categories::text[] AS categories, "categoryLabel", "fuelType", options FROM cars',
    );

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
router.get("/", async (req: Request, res: Response) => {
  try {
    const { country, isAvailable, category, locationId } = req.query;

    const cars = await listPublicCars(databasePool(), {
      country: country && country !== "all" ? String(country).toUpperCase() : null,
      available: isAvailable === undefined ? null : isAvailable === "true",
      category: category && category !== "all" ? String(category) : null,
      locationId: locationId ? String(locationId) : null,
    });

    const data = cars.map(formatCar);
    res.json({ success: true, count: data.length, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Administrative inventory includes live booking state and unformatted edit values.
router.get("/admin", requireAdmin, async (_req, res, next) => {
  try {
    const now = new Date();
    const cars = await listInventory(databasePool());
    res.set("Cache-Control", "no-store").json({
      success: true,
      data: cars.map((car) => ({
        ...formatCar(car),
        rawModel: effectiveCar(car).model,
        year: car.year,
        categories: effectiveCar(car).categories,
        transmissionType: effectiveCar(car).transmissionType,
        featureCodes: effectiveCar(car).featureCodes,
        options: effectiveCar(car).options,
        ...carState(car, now),
      })),
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/cars/:id - ดูรายละเอียดรถคนนั้นทั้งหมด
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const car = await publicCar(databasePool(), id);

    if (!car) {
      return res.status(404).json({ success: false, message: "Car not found" });
    }

    res.json({ success: true, data: formatCar(car) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/cars - เพิ่มข้อมูลรถ (สำหรับระบบหลังบ้าน Admin)
router.post("/", requireJson, requireAdmin, async (req, res, next) => {
  if (Object.hasOwn(req.body ?? {}, "carModelLocationId")) {
    return createInventoryCar(req, res, next);
  }

  try {
    const data = carInputSchema.parse(req.body);
    if (!(await validCarLocation(data.country, data.locationId))) {
      res
        .status(400)
        .json({
          success: false,
          message: "Country and pickup location must match",
        });
      return;
    }
    const car = await withTransaction(async (tx) => {
      await lockCarInventory(tx);
      const [created] = await insertRows(tx, "cars", [
        { ...data, operationalStatus: resolveOperationalStatus(data.isAvailable) },
      ]);
      await attachLegacyCar(tx, required(await findCar(tx, created.id)));
      return required(await findCar(tx, created.id));
    });

    res.status(201).json({ success: true, data: formatCar(car) });
  } catch (error) {
    next(error);
  }
});

async function validCarLocation(country: string, locationId: string | null) {
  const row = await queryOne<{ code: string }>(
    databasePool(),
    `SELECT code FROM countries WHERE code::text = $1
      AND ($2::text IS NULL OR EXISTS (
        SELECT 1 FROM locations WHERE id = $2 AND "countryCode" = countries.code
      ))`,
    [country, locationId],
  );
  return row !== null;
}

router.patch("/:id", requireJson, requireAdmin, async (req, res, next) => {
  if (Object.hasOwn(req.body ?? {}, "carModelLocationId")) {
    return updateInventoryCar(req, res, next);
  }

  try {
    const data = carInputSchema.parse(req.body);
    if (!(await validCarLocation(data.country, data.locationId))) {
      res
        .status(400)
        .json({
          success: false,
          message: "Country and pickup location must match",
        });
      return;
    }
    const car = await withTransaction(async (tx) => {
      await lockCarInventory(tx);
      // Share the reservation lock so a car cannot move while a booking is created.
      await lockCar(tx, req.params.id);
      const existing = await findCar(tx, req.params.id);
      if (!existing) throw new Error("CAR_NOT_FOUND");
      const changedSpecification = Object.entries(modelData(data)).some(
        ([key, value]) => !isDeepStrictEqual(existing[key as keyof Specification], value),
      );
      if (((existing.isAvailable && !data.isAvailable) || changedSpecification) &&
        await hasReservations(tx, existing.id)) {
        throw new Error("HAS_ACTIVE_BOOKINGS");
      }
      if ((existing.country !== data.country || existing.locationId !== data.locationId) &&
        await hasReservations(tx, existing.id, new Date())) {
        throw new Error("CAR_LOCATION_BOOKED");
      }
      await updateRows(tx, "cars", {
        ...data,
        operationalStatus: resolveOperationalStatus(data.isAvailable, undefined, existing.operationalStatus),
        carModelLocationId: null,
      }, { id: existing.id });
      await attachLegacyCar(
        tx, required(await findCar(tx, existing.id)), existing.carModelLocation?.carModel.imageUrl,
      );
      return required(await findCar(tx, existing.id));
    });
    res.json({ success: true, data: formatCar(car) });
  } catch (error) {
    if (error instanceof Error && error.message === "CAR_NOT_FOUND") {
      res.status(404).json({ success: false, message: "Car not found" });
      return;
    }
    if (error instanceof Error && error.message === "CAR_LOCATION_BOOKED") {
      res
        .status(409)
        .json({
          success: false,
          message: "Car has upcoming bookings; location cannot change",
        });
      return;
    }
    next(error);
  }
});

export default router;
