import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import {
  emailSchema,
  passwordSchema,
  publicUserSelect,
} from "../lib/registration.js";
import { requireAdmin, requireJson } from "../middleware/auth.js";
import { hashPassword } from "../utils/password.js";

const router = Router();
const memberSelect = {
  ...publicUserSelect,
  isActive: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;
const fields = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: emailSchema,
    phoneNumber: z.string().trim().max(30).nullable(),
    role: z.enum(["USER", "ADMIN"]),
    isActive: z.boolean(),
  })
  .strict();
const createSchema = fields.extend({ password: passwordSchema });
const updateSchema = fields
  .partial()
  .refine((value) => Object.keys(value).length > 0);
const pagination = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});
const listSchema = pagination.extend({
  search: z.string().trim().max(254).default(""),
  role: z.enum(["all", "USER", "ADMIN"]).default("all"),
  status: z.enum(["all", "active", "suspended"]).default("all"),
});

router.use(requireAdmin);
router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.get("/", async (req, res, next) => {
  try {
    const input = listSchema.parse(req.query);
    const where: Prisma.UserWhereInput = {
      ...(input.role === "all" ? {} : { role: input.role }),
      ...(input.status === "all"
        ? {}
        : { isActive: input.status === "active" }),
      ...(input.search
        ? {
            OR: ["name", "email", "phoneNumber"].map((field) => ({
              [field]: { contains: input.search, mode: "insensitive" },
            })),
          }
        : {}),
    };
    const result = await prisma.$transaction(
      async (tx) => {
        const total = await tx.user.count({ where });
        const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
        const page = Math.min(input.page, totalPages);
        const users = await tx.user.findMany({
          where,
          select: { ...memberSelect, _count: { select: { bookings: true } } },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          skip: (page - 1) * input.pageSize,
          take: input.pageSize,
        });
        const spending = await tx.booking.groupBy({
          by: ["userId"],
          where: {
            userId: { in: users.map((user) => user.id) },
            status: { in: ["APPROVED", "COMPLETED"] },
          },
          _sum: { totalPrice: true },
        });
        const amounts = new Map(
          spending.map((item) => [
            item.userId,
            item._sum.totalPrice?.toString() ?? "0",
          ]),
        );
        const [all, active, admins] = await Promise.all([
          tx.user.count(),
          tx.user.count({ where: { isActive: true } }),
          tx.user.count({ where: { role: "ADMIN" } }),
        ]);
        return {
          data: users.map(({ _count, ...user }) => ({
            ...user,
            bookingCount: _count.bookings,
            totalSpend: amounts.get(user.id) ?? "0",
          })),
          pagination: { page, pageSize: input.pageSize, total, totalPages },
          summary: { total: all, active, suspended: all - active, admins },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

router.post("/", requireJson, async (req, res, next) => {
  try {
    const { password, ...input } = createSchema.parse(req.body);
    const user = await prisma.user.create({
      data: {
        ...input,
        phoneNumber: input.phoneNumber || null,
        password: await hashPassword(password),
      },
      select: memberSelect,
    });
    res.status(201).json({ success: true, data: user });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      res
        .status(409)
        .json({
          success: false,
          message: "อีเมลนี้มีบัญชีอยู่แล้ว กรุณาใช้อีเมลอื่น",
        });
      return;
    }
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const input = pagination.parse(req.query);
    const result = await prisma.$transaction(
      async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: req.params.id },
          select: memberSelect,
        });
        if (!user) return null;
        const total = await tx.booking.count({ where: { userId: user.id } });
        const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
        const page = Math.min(input.page, totalPages);
        const bookings = await tx.booking.findMany({
          where: { userId: user.id },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          skip: (page - 1) * input.pageSize,
          take: input.pageSize,
          select: {
            id: true,
            bookingNumber: true,
            startDateTime: true,
            endDateTime: true,
            totalPrice: true,
            currencyCode: true,
            timeZone: true,
            status: true,
            source: true,
            driverName: true,
            internationalDrivingPermit: true,
            carSnapshot: true,
            car: { select: { brand: true, model: true, licensePlate: true } },
            pickupLocation: { select: { name: true, nameTh: true } },
            dropoffLocation: { select: { name: true, nameTh: true } },
          },
        });
        const spend = await tx.booking.aggregate({
          where: { userId: user.id, status: { in: ["APPROVED", "COMPLETED"] } },
          _sum: { totalPrice: true },
        });
        return {
          ...user,
          bookingCount: total,
          totalSpend: spend._sum.totalPrice?.toString() ?? "0",
          bookings,
          pagination: { page, pageSize: input.pageSize, total, totalPages },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    if (!result) {
      res
        .status(404)
        .json({ success: false, message: "ไม่พบสมาชิก กรุณาโหลดข้อมูลใหม่" });
      return;
    }
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", requireJson, async (req, res, next) => {
  try {
    const input = updateSchema.parse(req.body);
    const actorId: string = res.locals.session.user.id;
    if (
      req.params.id === actorId &&
      (input.role === "USER" || input.isActive === false)
    ) {
      res
        .status(409)
        .json({
          success: false,
          message: "ไม่สามารถลดสิทธิ์หรือระงับบัญชีของตนเองได้",
        });
      return;
    }
    const result = await prisma.$transaction(async (tx) => {
      // Serialize permission changes and recheck the actor after waiting for other admins.
      await tx.$queryRaw`SELECT id FROM users WHERE role = 'ADMIN' AND "isActive" = true ORDER BY id FOR UPDATE`;
      const actor = await tx.user.findUnique({
        where: { id: actorId },
        select: { role: true, isActive: true },
      });
      if (actor?.role !== "ADMIN" || !actor.isActive)
        return { status: 403, message: "บัญชีนี้ไม่มีสิทธิ์ผู้ดูแลระบบ" };
      const current = await tx.user.findUnique({
        where: { id: req.params.id },
        select: memberSelect,
      });
      if (!current)
        return { status: 404, message: "ไม่พบสมาชิก กรุณาโหลดข้อมูลใหม่" };
      const revoke =
        (input.isActive === false && current.isActive) ||
        (input.role !== undefined && input.role !== current.role);
      const data = await tx.user.update({
        where: { id: current.id },
        data: {
          ...input,
          ...(input.phoneNumber !== undefined
            ? { phoneNumber: input.phoneNumber || null }
            : {}),
          ...(revoke ? { sessionVersion: { increment: 1 } } : {}),
        },
        select: memberSelect,
      });
      return { status: 200, data };
    });
    res
      .status(result.status)
      .json(
        "data" in result
          ? { success: true, data: result.data }
          : { success: false, message: result.message },
      );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      res
        .status(409)
        .json({
          success: false,
          message: "อีเมลนี้มีบัญชีอยู่แล้ว กรุณาใช้อีเมลอื่น",
        });
      return;
    }
    next(error);
  }
});

export default router;
