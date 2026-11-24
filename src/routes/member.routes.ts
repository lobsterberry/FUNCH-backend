import { Router } from "express";
import { z } from "zod";
import { isUniqueViolation, queryOne, queryRows, required, withTransaction } from "../lib/db.js";
import { createUser, memberColumns, type Member } from "../lib/users.js";
import {
  emailSchema,
  passwordSchema,
} from "../lib/registration.js";
import { requireAdmin, requireJson } from "../middleware/auth.js";
import { hashPassword } from "../utils/password.js";

const router = Router();
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
    const result = await withTransaction(async (tx) => {
      const filters = `FROM users u
        WHERE ($1::"Role" IS NULL OR u.role = $1) AND ($2::boolean IS NULL OR u."isActive" = $2)
          AND ($3::text IS NULL OR u.name ILIKE $3 OR u.email ILIKE $3 OR u."phoneNumber" ILIKE $3)`;
      const values = [
        input.role === "all" ? null : input.role,
        input.status === "all" ? null : input.status === "active",
        input.search ? "%" + input.search + "%" : null,
      ];
      const { total } = required(await queryOne<{ total: number }>(
        tx, "SELECT count(*)::integer AS total " + filters, values,
      ));
      const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
      const page = Math.min(input.page, totalPages);
      const users = await queryRows<Member & { bookingCount: number; totalSpend: string }>(tx, `
        SELECT ${memberColumns},
          (SELECT count(*)::integer FROM bookings b WHERE b."userId" = u.id) AS "bookingCount",
          COALESCE((SELECT sum(b."totalPrice") FROM bookings b WHERE b."userId" = u.id
            AND b.status IN ('APPROVED', 'COMPLETED')), 0) AS "totalSpend"
        ${filters} ORDER BY u."createdAt" DESC, u.id LIMIT $4 OFFSET $5`,
        [...values, input.pageSize, (page - 1) * input.pageSize]);
      const summary = required(await queryOne<{ total: number; active: number; suspended: number; admins: number }>(
        tx, `SELECT count(*)::integer AS total,
          (count(*) FILTER (WHERE "isActive"))::integer AS active,
          (count(*) FILTER (WHERE NOT "isActive"))::integer AS suspended,
          (count(*) FILTER (WHERE role = 'ADMIN'))::integer AS admins FROM users`,
      ));
      return { data: users, pagination: { page, pageSize: input.pageSize, total, totalPages }, summary };
    }, { repeatableRead: true });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

router.post("/", requireJson, async (req, res, next) => {
  try {
    const { password, ...input } = createSchema.parse(req.body);
    const user = await createUser({
      ...input, phoneNumber: input.phoneNumber || null, password: await hashPassword(password),
    });
    res.status(201).json({ success: true, data: user });
  } catch (error) {
    if (isUniqueViolation(error, "users_email_key")) {
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
    const result = await withTransaction(async (tx) => {
      const user = await queryOne<Member>(tx, "SELECT " + memberColumns + " FROM users WHERE id = $1", [req.params.id]);
      if (!user) return null;
      const { total, totalSpend } = required(await queryOne<{ total: number; totalSpend: string }>(tx, `
        SELECT count(*)::integer AS total,
          COALESCE(sum("totalPrice") FILTER (WHERE status IN ('APPROVED', 'COMPLETED')), 0) AS "totalSpend"
        FROM bookings WHERE "userId" = $1`, [user.id]));
      const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
      const page = Math.min(input.page, totalPages);
      const bookings = await queryRows(tx, `
        SELECT b.id, b."bookingNumber", b."startDateTime", b."endDateTime", b."totalPrice", b."currencyCode",
          b."timeZone", b.status, b.source, b."driverName", b."internationalDrivingPermit", b."carSnapshot",
          jsonb_build_object('brand', c.brand, 'model', c.model, 'licensePlate', c."licensePlate") AS car,
          CASE WHEN p.id IS NOT NULL THEN jsonb_build_object('name', p.name, 'nameTh', p."nameTh") END AS "pickupLocation",
          CASE WHEN d.id IS NOT NULL THEN jsonb_build_object('name', d.name, 'nameTh', d."nameTh") END AS "dropoffLocation"
        FROM bookings b JOIN cars c ON c.id = b."carId"
        LEFT JOIN locations p ON p.id = b."pickupLocationId"
        LEFT JOIN locations d ON d.id = b."dropoffLocationId"
        WHERE b."userId" = $1 ORDER BY b."createdAt" DESC, b.id LIMIT $2 OFFSET $3`,
        [user.id, input.pageSize, (page - 1) * input.pageSize]);
      return {
        ...user,
        bookingCount: total,
        totalSpend,
        bookings,
        pagination: { page, pageSize: input.pageSize, total, totalPages },
      };
    }, { repeatableRead: true });
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
    const result = await withTransaction(async (tx) => {
      // Serialize permission changes and recheck the actor after waiting for other admins.
      await tx.query(`SELECT id FROM users WHERE role = 'ADMIN' AND "isActive" ORDER BY id FOR UPDATE`);
      const actor = await queryOne<Pick<Member, "role" | "isActive">>(
        tx, 'SELECT role, "isActive" FROM users WHERE id = $1', [actorId],
      );
      if (actor?.role !== "ADMIN" || !actor.isActive)
        return { status: 403, message: "บัญชีนี้ไม่มีสิทธิ์ผู้ดูแลระบบ" };
      const current = await queryOne<Member>(
        tx, "SELECT " + memberColumns + " FROM users WHERE id = $1 FOR UPDATE", [req.params.id],
      );
      if (!current)
        return { status: 404, message: "ไม่พบสมาชิก กรุณาโหลดข้อมูลใหม่" };
      const revoke =
        (input.isActive === false && current.isActive) ||
        (input.role !== undefined && input.role !== current.role);
      const phoneNumber = input.phoneNumber === undefined ? current.phoneNumber : input.phoneNumber || null;
      const data = required(await queryOne<Member>(tx, `
        UPDATE users SET name = $2, email = $3, "phoneNumber" = $4, role = $5, "isActive" = $6,
          "sessionVersion" = "sessionVersion" + $7, "updatedAt" = $8
        WHERE id = $1 RETURNING ${memberColumns}`,
        [current.id, input.name ?? current.name, input.email ?? current.email, phoneNumber,
          input.role ?? current.role, input.isActive ?? current.isActive, revoke ? 1 : 0, new Date()]));
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
    if (isUniqueViolation(error, "users_email_key")) {
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
