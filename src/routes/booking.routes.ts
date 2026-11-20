import { Router } from "express";
import { bookingStatuses, type BookingStatus } from "../lib/db-types.js";
import type { PoolClient } from "pg";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { databasePool, required, withTransaction } from "../lib/db.js";
import { insertRows, updateRows } from "../lib/db-write.js";
import { adminBookings, bookingHistory, createBooking, findBooking } from "../lib/booking-queries.js";
import {
  branchOffer, candidateCars, findCar, findLocation, findOffer, lockCar, lockCarInventory, reservations,
} from "../lib/inventory-queries.js";
import { createUser } from "../lib/users.js";
import { registrationSchema, registrationData } from "../lib/registration.js";
import { requireAdmin, requireAuth, requireJson } from "../middleware/auth.js";
import { calculateCarRentalPrice } from "../utils/pricing.js";
import { canSchedule, effectiveCar, reservedStatuses, validItinerary } from "../lib/car-inventory.js";

const router = Router();
const rentalFields = {
  carId: z.string().min(1).optional(),
  carModelLocationId: z.string().min(1).optional(),
  startDateTime: z.string().datetime({ offset: true }),
  endDateTime: z.string().datetime({ offset: true }),
  pickupLocationId: z.string().min(1).optional(),
  dropoffLocationId: z.string().min(1).optional(),
};
const validateRental = (data: {
  carId?: string;
  carModelLocationId?: string;
  startDateTime: string;
  endDateTime: string;
}) =>
  Boolean(data.carId) !== Boolean(data.carModelLocationId) &&
  new Date(data.endDateTime) > new Date(data.startDateTime);
const rentalSchema = z
  .object(rentalFields)
  .refine(validateRental, {
    message: "Select one car or offer and a valid rental period",
  });
const bookingSchema = z
  .object({
    ...rentalFields,
    registerUser: registrationSchema.optional(),
    userId: z.string().min(1).optional(),
    driverName: z.string().trim().min(1).max(100).optional(),
    internationalDrivingPermit: z.string().trim().min(1).max(100).optional(),
    quotedTotal: z.number().finite().nonnegative().optional(),
  })
  .strict()
  .refine(validateRental, {
    message: "Select one car or offer and a valid rental period",
  });
const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many booking attempts. Please try again later.",
  },
});

class RentalError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
type RentalInput = z.infer<typeof rentalSchema>;
async function rentalSelection(tx: PoolClient, input: RentalInput) {
  const physical = input.carId ? await findCar(tx, input.carId) : null;
  let offer = input.carModelLocationId ? await findOffer(tx, input.carModelLocationId) : null;
  if (physical?.carModelLocation && physical.locationId) {
    offer = await branchOffer(tx, physical.carModelLocation.carModelId, physical.locationId,
      physical.carModelLocation.providerName);
    if (!offer) throw new RentalError(409, "Car is unavailable");
  }
  if (!physical && !offer) throw new RentalError(404, "Car or offer not found");
  if (
    (physical &&
      (!physical.isAvailable || physical.operationalStatus !== "AVAILABLE")) ||
    (offer && !offer.isActive)
  )
    throw new RentalError(409, "Car is unavailable");
  const selected = offer ?? effectiveCar(physical);
  const pickupLocationId = offer?.locationId ?? physical?.locationId;
  if (
    !pickupLocationId ||
    (input.pickupLocationId && input.pickupLocationId !== pickupLocationId)
  ) {
    throw new RentalError(400, "Pickup location does not match the car");
  }
  const pickup = required(await findLocation(tx, pickupLocationId));
  const dropoffLocationId = input.dropoffLocationId || pickup.id;
  const dropoff = await findLocation(tx, dropoffLocationId);
  if (!dropoff || dropoff.countryCode !== pickup.countryCode)
    throw new RentalError(400, "Invalid dropoff location");
  const modelId = offer?.carModelId ?? physical?.carModelLocation?.carModelId;
  if (
    dropoff.id !== pickup.id &&
    (!modelId ||
      !(await branchOffer(tx, modelId, dropoff.id, selected.providerName)))
  )
    throw new RentalError(
      400,
      "This model cannot be returned at the selected location",
    );
  const turnaroundMinutes =
    offer?.turnaroundMinutes ??
    physical?.carModelLocation?.turnaroundMinutes ??
    0;
  const request = {
    startDateTime: new Date(input.startDateTime),
    endDateTime: new Date(input.endDateTime),
    pickupLocationId: pickup.id,
    dropoffLocationId: dropoff.id,
    turnaroundMinutes,
  };
  const pricing = calculateCarRentalPrice({
    ...input,
    hourlyRate: Number(selected.hourlyRate),
    dailyRate: Number(selected.dailyRate),
    timeZone: pickup.timeZone,
  });
  return { physical, offer, selected, pickup, dropoff, request, pricing };
}

router.post("/calculate", requireJson, async (req, res, next) => {
  try {
    const input = rentalSchema.parse(req.body);
    const result = await withTransaction(async (tx) => {
      const { selected, offer, physical, pricing } = await rentalSelection(
        tx,
        input,
      );
      return {
        car: {
          id: physical?.id ?? offer!.id,
          name: offer
            ? `${offer.carModel.brand} ${offer.carModel.model}`
            : `${selected.brand} ${selected.model}`,
          hourlyRate: selected.hourlyRate,
          dailyRate: selected.dailyRate,
        },
        calculation: pricing,
      };
    });
    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof RentalError) {
      res.status(error.status).json({ success: false, message: error.message });
      return;
    }
    next(error);
  }
});

router.get("/", requireAdmin, async (req, res, next) => {
  try {
    const input = z
      .object({
        status: z
          .union([z.enum(bookingStatuses), z.literal("all")])
          .default("all"),
        search: z.string().trim().max(254).default(""),
        country: z
          .string()
          .regex(/^(all|[A-Z]{2})$/)
          .default("all"),
        sort: z.enum(["newest", "pickup", "value"]).default("newest"),
        page: z.coerce.number().int().min(1).max(1_000_000).optional(),
        pageSize: z.coerce.number().int().min(1).max(100).optional(),
      })
      .parse(req.query);
    const result = await withTransaction((tx) => adminBookings(tx, input), { repeatableRead: true });
    res.set("Cache-Control", "no-store").json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

router.get("/mine", requireAuth, async (_req, res, next) => {
  try {
    const bookings = await bookingHistory(databasePool(), res.locals.session.user.id);
    res.set("Cache-Control", "no-store").json({ success: true, data: bookings });
  } catch (error) {
    next(error);
  }
});

router.post("/", requireJson, bookingLimiter, async (req, res, next) => {
  try {
    const input = bookingSchema.parse(req.body);
    const memberId: string | undefined = res.locals.session?.user?.id;
    if (!memberId && !input.registerUser) {
      res
        .status(401)
        .json({
          success: false,
          message: "Sign in or provide registerUser to book a car",
        });
      return;
    }
    if (input.userId && input.userId !== memberId) {
      res
        .status(403)
        .json({
          success: false,
          message: "Cannot book on behalf of another user",
        });
      return;
    }
    if (memberId && input.registerUser) {
      res
        .status(400)
        .json({
          success: false,
          message: "Signed-in users must omit registerUser",
        });
      return;
    }
    if (new Date(input.startDateTime).getTime() <= Date.now()) {
      res
        .status(400)
        .json({ success: false, message: "Pickup must be in the future" });
      return;
    }
    const expectedCar = input.carId
      ? await findCar(databasePool(), input.carId)
      : null;
    const newUserData = input.registerUser
      ? await registrationData(input.registerUser)
      : undefined;
    const booking = await withTransaction(
      async (tx) => {
        await lockCarInventory(tx);
        if (input.carId)
          await lockCar(tx, input.carId);
        if (input.carId && expectedCar) {
          const current = await findCar(tx, input.carId);
          if (
            !current ||
            current.updatedAt.getTime() !== expectedCar.updatedAt.getTime()
          ) {
            throw new RentalError(
              409,
              "Car details changed; please refresh and try again",
            );
          }
        }
        const { physical, offer, pickup, dropoff, request, pricing, selected } =
          await rentalSelection(tx, input);
        if (
          input.quotedTotal !== undefined &&
          Math.abs(input.quotedTotal - pricing.totalPrice) > 0.005
        )
          throw new RentalError(409, "PRICE_CHANGED");
        if (
          physical &&
          expectedCar &&
          expectedCar.updatedAt.getTime() !== physical.updatedAt.getTime()
        )
          throw new Error("CAR_CHANGED");
        const candidates = physical
          ? [physical]
          : await candidateCars(tx, offer!);
        let allocated: (typeof candidates)[number] | null = null;
        for (const candidate of candidates) {
          await lockCar(tx, candidate.id);
          const current = required(await findCar(tx, candidate.id));
          if (
            !current.isAvailable ||
            current.operationalStatus !== "AVAILABLE" ||
            current.updatedAt.getTime() !== candidate.updatedAt.getTime()
          )
            continue;
          const rentals = await reservations(tx, current.id);
          if (
            canSchedule(
              current.locationId,
              rentals,
              request,
              current.availableFrom,
            )
          ) {
            allocated = current;
            break;
          }
        }
        if (!allocated)
          throw new RentalError(
            409,
            "No car is available for these dates and locations",
          );
        const specification = offer?.carModel ?? effectiveCar(allocated);
        const userId =
          memberId ?? (await createUser(newUserData!, tx)).id;
        return createBooking(tx, {
          userId,
          carId: allocated.id,
          carModelLocationId: offer?.id ?? allocated.carModelLocationId,
          ...request,
          calculatedDays: pricing.days,
          calculatedHours: pricing.hours,
          totalPrice: pricing.totalPrice,
          pricingDetails: { breakdown: pricing.breakdown },
          hourlyRate: selected.hourlyRate,
          dailyRate: selected.dailyRate,
          currencyCode: selected.currencyCode,
          timeZone: pickup.timeZone,
          status: "PENDING",
          source: newUserData ? "REGISTER_AND_BOOK" : "EXISTING_MEMBER",
          driverName: input.driverName,
          internationalDrivingPermit: input.internationalDrivingPermit,
          carSnapshot: {
            brand: specification.brand,
            model: specification.model,
            year: allocated.year,
            licensePlate: allocated.licensePlate,
            providerName: selected.providerName || "FUNCH Rental",
            seats: specification.seats,
            transmission: specification.transmission,
            fuelType: specification.fuelType,
            steeringSide: specification.steeringSide,
            pickupLocationId: pickup.id,
            pickupLocationName: pickup.name,
            pickupTimeZone: pickup.timeZone,
            dropoffLocationId: dropoff.id,
            dropoffLocationName: dropoff.name,
            dropoffTimeZone: dropoff.timeZone,
          },
        });
      },
      { timeoutMs: 20_000 },
    );
    res.status(201).json({ success: true, data: booking });
  } catch (error) {
    if (error instanceof RentalError) {
      res.status(error.status).json({ success: false, message: error.message });
      return;
    }
    next(error);
  }
});

router.patch(
  "/:id/status",
  requireJson,
  requireAdmin,
  async (req, res, next) => {
    try {
      const { expectedUpdatedAt, ...input } = z
        .object({
          status: z.enum(bookingStatuses),
          adminNote: z.string().trim().max(2000).optional(),
          expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
        })
        .strict()
        .parse(req.body);
      const booking = await withTransaction(async (tx) => {
        await lockCarInventory(tx);
        const old = await findBooking(tx, req.params.id);
        if (!old) return null;
        if (
          expectedUpdatedAt &&
          old.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()
        ) {
          throw new RentalError(409, "BOOKING_CHANGED");
        }
        await lockCar(tx, old.carId);
        const car = required(await findCar(tx, old.carId));
        const allowed: Record<BookingStatus, BookingStatus[]> = {
          PENDING: ["APPROVED", "REJECTED", "CANCELLED"],
          APPROVED: ["CANCELLED", "COMPLETED"],
          REJECTED: ["PENDING", "APPROVED"],
          CANCELLED: ["PENDING", "APPROVED"],
          COMPLETED: [],
        };
        if (
          input.status !== old.status &&
          !allowed[old.status].includes(input.status)
        )
          throw new Error("INVALID_TRANSITION");
        const others = await reservations(tx, old.carId, old.id);
        const blocking = reservedStatuses.includes(
          input.status as (typeof reservedStatuses)[number],
        );
        const wasBlocking = reservedStatuses.includes(
          old.status as (typeof reservedStatuses)[number],
        );
        if (
          blocking &&
          (!car.isAvailable ||
            car.operationalStatus !== "AVAILABLE" ||
            (!wasBlocking && old.startDateTime <= new Date()))
        )
          throw new Error("SCHEDULE_CONFLICT");
        if (
          blocking &&
          others.some((rental) => rental.endDateTime <= new Date())
        )
          throw new Error("SCHEDULE_CONFLICT");
        let locationId = car.locationId;
        let availableFrom = car.availableFrom;
        if (input.status === "COMPLETED" && old.status !== "COMPLETED") {
          if (
            old.endDateTime > new Date() ||
            !old.dropoffLocationId ||
            others.some((r) => r.startDateTime < old.endDateTime)
          )
            throw new Error("INVALID_TRANSITION");
          locationId = old.dropoffLocationId;
          availableFrom = new Date(Date.now() + old.turnaroundMinutes * 60_000);
          await insertRows(tx, "car_movements", [{
            carId: old.carId,
            bookingId: old.id,
            fromLocationId: car.locationId,
            toLocationId: locationId,
            reason: "RENTAL_RETURN",
          }]);
          await updateRows(tx, "cars", { locationId, availableFrom }, { id: old.carId });
        }
        if (
          !validItinerary(
            locationId,
            blocking ? [...others, old] : others,
            availableFrom,
          )
        )
          throw new Error("SCHEDULE_CONFLICT");
        await updateRows(tx, "bookings", {
          ...input,
          approvedById: res.locals.session.user.id,
          reviewedAt: new Date(),
        }, { id: old.id });
        return required(await findBooking(tx, old.id));
      });
      if (!booking) {
        res.status(404).json({ success: false, message: "Booking not found" });
        return;
      }
      res.json({ success: true, data: booking });
    } catch (error) {
      if (error instanceof RentalError) {
        res
          .status(error.status)
          .json({ success: false, message: error.message });
        return;
      }
      next(error);
    }
  },
);

export default router;
