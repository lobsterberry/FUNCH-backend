import { Router } from "express";
import { BookingStatus, Prisma } from "@prisma/client";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { registrationSchema, registrationData } from "../lib/registration.js";
import { requireAdmin, requireJson } from "../middleware/auth.js";
import { calculateCarRentalPrice } from "../utils/pricing.js";
import {
  candidateCars,
  canSchedule,
  effectiveCar,
  inventoryInclude,
  lockFleet,
  offerInclude,
  reservedStatuses,
  validItinerary,
  type FleetTx,
} from "../lib/fleet.js";

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
async function rentalSelection(tx: FleetTx, input: RentalInput) {
  const physical = input.carId
    ? await tx.car.findUnique({
        where: { id: input.carId },
        include: inventoryInclude,
      })
    : null;
  let offer = input.carModelLocationId
    ? await tx.carModelLocation.findUnique({
        where: { id: input.carModelLocationId },
        include: offerInclude,
      })
    : null;
  if (physical?.carModelLocation && physical.locationId) {
    offer = await tx.carModelLocation.findFirst({
      where: {
        carModelId: physical.carModelLocation.carModelId,
        providerName: physical.carModelLocation.providerName,
        locationId: physical.locationId,
        isActive: true,
      },
      include: offerInclude,
      orderBy: { id: "asc" },
    });
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
  const pickup = await tx.location.findUniqueOrThrow({
    where: { id: pickupLocationId },
  });
  const dropoffLocationId = input.dropoffLocationId || pickup.id;
  const dropoff = await tx.location.findUnique({
    where: { id: dropoffLocationId },
  });
  if (!dropoff || dropoff.countryCode !== pickup.countryCode)
    throw new RentalError(400, "Invalid dropoff location");
  const modelId = offer?.carModelId ?? physical?.carModelLocation?.carModelId;
  if (
    dropoff.id !== pickup.id &&
    (!modelId ||
      !(await tx.carModelLocation.findFirst({
        where: {
          carModelId: modelId,
          locationId: dropoff.id,
          providerName: selected.providerName,
          isActive: true,
        },
      })))
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
    const result = await prisma.$transaction(async (tx) => {
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
          .union([z.nativeEnum(BookingStatus), z.literal("all")])
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
    const where: Prisma.BookingWhereInput = {
      ...(input.status === "all" ? {} : { status: input.status }),
      ...(input.country === "all" ? {} : { car: { country: input.country } }),
      ...(input.search
        ? {
            OR: [
              {
                bookingNumber: { contains: input.search, mode: "insensitive" },
              },
              {
                user: {
                  OR: ["name", "email", "phoneNumber"].map((field) => ({
                    [field]: { contains: input.search, mode: "insensitive" },
                  })),
                },
              },
              {
                car: {
                  OR: ["brand", "model", "licensePlate"].map((field) => ({
                    [field]: { contains: input.search, mode: "insensitive" },
                  })),
                },
              },
              { driverName: { contains: input.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const result = await prisma.$transaction(
      async (tx) => {
        const total = await tx.booking.count({ where });
        // Keep the existing unpaginated API contract for callers that omit pagination.
        const paginated =
          input.page !== undefined || input.pageSize !== undefined;
        const pageSize = input.pageSize ?? 10;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const page = Math.min(input.page ?? 1, totalPages);
        const orderBy: Prisma.BookingOrderByWithRelationInput[] =
          input.sort === "pickup"
            ? [{ startDateTime: "asc" }, { id: "asc" }]
            : input.sort === "value"
              ? [{ totalPrice: "desc" }, { id: "asc" }]
              : [{ createdAt: "desc" }, { id: "asc" }];
        const bookings = await tx.booking.findMany({
          where,
          include: {
            car: true,
            pickupLocation: true,
            dropoffLocation: true,
            user: {
              select: { id: true, name: true, email: true, phoneNumber: true },
            },
            approvedBy: { select: { id: true, name: true, email: true } },
          },
          orderBy,
          ...(paginated ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
        });
        const groups = await tx.booking.groupBy({
          by: ["status"],
          _count: { _all: true },
        });
        const summary = Object.fromEntries(
          Object.values(BookingStatus).map((status) => [
            status,
            groups.find((group) => group.status === status)?._count._all ?? 0,
          ]),
        );
        const countries = await tx.country.findMany({
          select: { code: true, name: true, nameTh: true, flag: true },
          orderBy: { name: "asc" },
        });
        return {
          data: bookings,
          count: total,
          summary,
          countries,
          ...(paginated
            ? { pagination: { page, pageSize, total, totalPages } }
            : {}),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    res.set("Cache-Control", "no-store").json({ success: true, ...result });
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
      ? await prisma.car.findUnique({ where: { id: input.carId } })
      : null;
    const newUserData = input.registerUser
      ? await registrationData(input.registerUser)
      : undefined;
    const booking = await prisma.$transaction(
      async (tx) => {
        await lockFleet(tx);
        if (input.carId)
          await tx.$queryRaw`SELECT id FROM cars WHERE id = ${input.carId} FOR UPDATE`;
        if (input.carId && expectedCar) {
          const current = await tx.car.findUnique({
            where: { id: input.carId },
          });
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
          await tx.$queryRaw`SELECT id FROM cars WHERE id = ${candidate.id} FOR UPDATE`;
          const current = await tx.car.findUniqueOrThrow({
            where: { id: candidate.id },
            include: inventoryInclude,
          });
          if (
            !current.isAvailable ||
            current.operationalStatus !== "AVAILABLE" ||
            current.updatedAt.getTime() !== candidate.updatedAt.getTime()
          )
            continue;
          const rentals = await tx.booking.findMany({
            where: { carId: current.id, status: { in: [...reservedStatuses] } },
          });
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
          memberId ?? (await tx.user.create({ data: newUserData! })).id;
        return tx.booking.create({
          data: {
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
          },
          include: {
            car: true,
            user: { select: { id: true, name: true, email: true } },
          },
        });
      },
      { maxWait: 10_000, timeout: 20_000 },
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
          status: z.nativeEnum(BookingStatus),
          adminNote: z.string().trim().max(2000).optional(),
          expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
        })
        .strict()
        .parse(req.body);
      const booking = await prisma.$transaction(async (tx) => {
        await lockFleet(tx);
        const old = await tx.booking.findUnique({
          where: { id: req.params.id },
          include: { car: true },
        });
        if (!old) return null;
        if (
          expectedUpdatedAt &&
          old.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()
        ) {
          throw new RentalError(409, "BOOKING_CHANGED");
        }
        await tx.$queryRaw`SELECT id FROM cars WHERE id = ${old.carId} FOR UPDATE`;
        const car = await tx.car.findUniqueOrThrow({
          where: { id: old.carId },
        });
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
        const others = await tx.booking.findMany({
          where: {
            carId: old.carId,
            id: { not: old.id },
            status: { in: [...reservedStatuses] },
          },
        });
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
          await tx.carMovement.create({
            data: {
              carId: old.carId,
              bookingId: old.id,
              fromLocationId: car.locationId,
              toLocationId: locationId,
              reason: "RENTAL_RETURN",
            },
          });
          await tx.car.update({
            where: { id: old.carId },
            data: { locationId, availableFrom },
          });
        }
        if (
          !validItinerary(
            locationId,
            blocking ? [...others, old] : others,
            availableFrom,
          )
        )
          throw new Error("SCHEDULE_CONFLICT");
        return tx.booking.update({
          where: { id: old.id },
          data: {
            ...input,
            approvedById: res.locals.session.user.id,
            reviewedAt: new Date(),
          },
        });
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
